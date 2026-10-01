import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrComment, PrSummary, PullRequest, ReviewThread } from '$lib/pr/types';
import { mergeBase, resolveCommit } from './git';

const exec = promisify(execFile);

/** gh run in the repo, it finds the GitHub repository from its remotes. */
async function gh(root: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await exec('gh', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
		return stdout;
	} catch (error) {
		if ((error as { code?: string }).code === 'ENOENT') {
			throw new Error('Pull requests need gh, the GitHub CLI: https://cli.github.com');
		}
		throw error;
	}
}

async function git(root: string, args: string[]): Promise<string> {
	const { stdout } = await exec('git', ['-C', root, ...args]);
	return stdout;
}

/** A pull request number from the url, before it gets near gh. */
export function checkPrNumber(value: string | number): number {
	const text = String(value);
	if (!/^[1-9]\d{0,9}$/.test(text)) throw new Error(`Invalid pull request number: ${text}`);
	return Number(text);
}

// ponytail: the first 100 of each, no paging. A PR with more threads or comments loses the rest
const QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id number title body url state isDraft
      author { login }
      baseRefName headRefName baseRefOid headRefOid
      baseRepository { url sshUrl }
      comments(first: 100) { nodes { id author { login } body createdAt url } }
      reviews(states: PENDING, first: 1) { nodes { id } }
      reviewThreads(first: 100) {
        nodes {
          id path line startLine diffSide subjectType isResolved isOutdated
          comments(first: 100) { nodes { id author { login } body createdAt url state diffHunk } }
        }
      }
    }
  }
}`;

interface RawComment {
	id: string;
	author: { login: string } | null;
	body: string;
	createdAt: string;
	url: string;
	state?: string;
	diffHunk?: string;
}

export interface RawPullRequest {
	id: string;
	number: number;
	title: string;
	body: string;
	url: string;
	state: PullRequest['state'];
	isDraft: boolean;
	author: { login: string } | null;
	baseRefName: string;
	headRefName: string;
	baseRefOid: string;
	headRefOid: string;
	baseRepository: { url: string; sshUrl: string };
	comments: { nodes: RawComment[] };
	reviews: { nodes: { id: string }[] };
	reviewThreads: {
		nodes: {
			id: string;
			path: string;
			line: number | null;
			startLine: number | null;
			diffSide: 'LEFT' | 'RIGHT';
			subjectType: 'LINE' | 'FILE';
			isResolved: boolean;
			isOutdated: boolean;
			comments: { nodes: RawComment[] };
		}[];
	};
}

/** What GitHub's GraphQL answers, as a PullRequest. */
export function toPullRequest(raw: RawPullRequest): PullRequest {
	const comment = (c: RawComment): PrComment => ({
		id: c.id,
		// a deleted account has no author
		author: c.author?.login ?? 'ghost',
		body: c.body,
		createdAt: c.createdAt,
		url: c.url,
		pending: c.state === 'PENDING'
	});
	const threads = raw.reviewThreads.nodes.map((t): ReviewThread => ({
		id: t.id,
		path: t.path,
		file: t.subjectType === 'FILE',
		line: t.line,
		startLine: t.startLine,
		side: t.diffSide === 'LEFT' ? 'old' : 'new',
		isResolved: t.isResolved,
		isOutdated: t.isOutdated,
		diffHunk: t.comments.nodes[0]?.diffHunk ?? '',
		comments: t.comments.nodes.map(comment)
	}));
	return {
		id: raw.id,
		number: raw.number,
		title: raw.title,
		body: raw.body,
		url: raw.url,
		author: raw.author?.login ?? 'ghost',
		state: raw.state,
		isDraft: raw.isDraft,
		baseRefName: raw.baseRefName,
		headRefName: raw.headRefName,
		baseRefOid: raw.baseRefOid,
		headRefOid: raw.headRefOid,
		comments: raw.comments.nodes.map(comment),
		threads,
		pendingReviewId: raw.reviews.nodes[0]?.id ?? null
	};
}

async function fetchRaw(root: string, number: number): Promise<RawPullRequest> {
	const out = await gh(root, [
		'api',
		'graphql',
		// gh fills these in from the repo's remotes
		'-F',
		'owner={owner}',
		'-F',
		'repo={repo}',
		'-F',
		`number=${number}`,
		'-f',
		`query=${QUERY}`
	]);
	const pr = JSON.parse(out).data?.repository?.pullRequest;
	if (!pr) throw new Error(`No pull request #${number}`);
	return pr;
}

/** A pull request as GitHub has it now, without fetching its commits. */
export async function loadPullRequest(root: string, number: number): Promise<PullRequest> {
	return toPullRequest(await fetchRaw(root, checkPrNumber(number)));
}

/**
 * A pull request and the range its diff is: from where its head split off its base
 * to its head. Fetches the commits first when they aren't here, fork PRs included.
 */
export async function readPullRequest(
	root: string,
	number: number
): Promise<{ pr: PullRequest; from: string; to: string }> {
	const raw = await fetchRaw(root, checkPrNumber(number));
	const pr = toPullRequest(raw);
	const have = (sha: string) => resolveCommit(root, sha).then(Boolean, () => false);
	const [haveHead, haveBase] = await Promise.all([have(pr.headRefOid), have(pr.baseRefOid)]);
	if (!haveHead || !haveBase) {
		const ssh = (await gh(root, ['config', 'get', 'git_protocol']).catch(() => '')).trim();
		const url = ssh === 'ssh' ? raw.baseRepository.sshUrl : raw.baseRepository.url;
		// into FETCH_HEAD only, no refs of the repo change
		if (!haveHead) await git(root, ['fetch', '--quiet', url, `refs/pull/${number}/head`]);
		// the base by its commit, its branch may have been deleted since. GitHub still hands
		// out a commit it has, so only a base that's gone from it fails
		if (!haveBase) await git(root, ['fetch', '--quiet', url, pr.baseRefOid]).catch(() => {});
	}
	if (!(await have(pr.baseRefOid))) {
		throw new Error(`The base of #${number}, ${pr.baseRefName}, can't be fetched from GitHub`);
	}
	const [from, to] = await Promise.all([
		mergeBase(root, pr.baseRefOid, pr.headRefOid),
		resolveCommit(root, pr.headRefOid)
	]);
	if (!from) throw new Error(`#${number} shares no history with ${pr.baseRefName}`);
	return { pr, from, to };
}

/** Open pull requests, null when gh isn't installed or signed in, or the repo isn't on GitHub. */
export async function listPullRequests(root: string): Promise<PrSummary[] | null> {
	const fields = 'number,title,author,headRefName,baseRefName,isDraft,updatedAt';
	try {
		const out = await gh(root, ['pr', 'list', '--limit', '100', '--json', fields]);
		return (JSON.parse(out) as (Omit<PrSummary, 'author'> & { author: { login: string } })[]).map(
			(p) => ({ ...p, author: p.author?.login ?? 'ghost' })
		);
	} catch {
		return null;
	}
}
