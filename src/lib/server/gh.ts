import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Suggestion } from '$lib/ask/types';
import type { PrComment, PrSummary, PullRequest, ReviewState, ReviewThread } from '$lib/pr/types';
import { sameSha } from '$lib/refs';
import { mergeBase, resolveCommit } from './git';
import { cleanGithubHtml } from './github-html';

const exec = promisify(execFile);

/** gh run in the repo, it finds the GitHub repository from its remotes. `input` goes in on stdin. */
async function gh(root: string, args: string[], input?: string): Promise<string> {
	try {
		const run = exec('gh', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
		run.child.stdin?.end(input);
		const { stdout } = await run;
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

/**
 * git fetch with gh's login, the one the pr list already works with. git's own may have
 * none for GitHub, and without a terminal to prompt it fails instead of hanging the request
 */
async function gitFetch(root: string, args: string[]): Promise<string> {
	const { stdout } = await exec(
		'git',
		[
			'-C',
			root,
			'-c',
			'credential.helper=',
			'-c',
			'credential.helper=!gh auth git-credential',
			'fetch',
			...args
		],
		{ env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
	);
	return stdout;
}

/** A pull request number from the url, before it gets near gh. */
export function checkPrNumber(value: string | number): number {
	const text = String(value);
	if (!/^[1-9]\d{0,9}$/.test(text)) throw new Error(`Invalid pull request number: ${text}`);
	return Number(text);
}

// ponytail: the first 100 of each, no paging. A PR with more threads or comments loses the rest.
// Avatars at twice the size they're shown, for sharp screens
const QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id number title body bodyHTML url state isDraft
      author { login }
      baseRefName headRefName baseRefOid headRefOid
      baseRepository { url sshUrl }
      comments(first: 100) { nodes { id author { login avatarUrl(size: 40) } body bodyHTML createdAt url } }
      reviews(states: PENDING, first: 1) { nodes { id } }
      submitted: reviews(states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED], first: 100) {
        nodes { id author { login avatarUrl(size: 40) } state body bodyHTML submittedAt url }
      }
      reviewThreads(first: 100) {
        nodes {
          id path line startLine diffSide subjectType isResolved isOutdated
          comments(first: 100) {
            nodes { id author { login avatarUrl(size: 40) } body bodyHTML createdAt url state diffHunk pullRequestReview { id } }
          }
        }
      }
    }
  }
}`;

interface RawComment {
	id: string;
	author: { login: string; avatarUrl: string } | null;
	body: string;
	bodyHTML: string;
	createdAt: string;
	url: string;
	state?: string;
	diffHunk?: string;
	/** the review a line comment was made in */
	pullRequestReview?: { id: string } | null;
}

export interface RawPullRequest {
	id: string;
	number: number;
	title: string;
	body: string;
	bodyHTML: string;
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
	submitted: {
		nodes: (Omit<RawComment, 'createdAt' | 'diffHunk'> & {
			state: ReviewState;
			submittedAt: string;
		})[];
	};
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
		avatar: c.author?.avatarUrl ?? '',
		body: c.body,
		html: cleanGithubHtml(c.bodyHTML),
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
	// a thread belongs to the review that started it, replies and all: answering with
	// "Add single comment" makes a review of each reply, it says nothing on its own
	const started = new Map<string, string[]>();
	for (const t of raw.reviewThreads.nodes) {
		const review = t.comments.nodes[0]?.pullRequestReview?.id;
		if (review) started.set(review, [...(started.get(review) ?? []), t.id]);
	}
	const reviews = raw.submitted.nodes
		.filter(
			(r) =>
				r.body.trim() ||
				r.state === 'APPROVED' ||
				r.state === 'CHANGES_REQUESTED' ||
				started.has(r.id)
		)
		.map((r) => ({
			...comment({ ...r, createdAt: r.submittedAt }),
			review: r.state,
			threads: started.get(r.id) ?? []
		}));
	// newest activity last: a fresh reply brings its review along, among the latest
	const activity = (c: PrComment) =>
		(c.threads ?? []).reduce((at, id) => {
			const last = threads.find((t) => t.id === id)?.comments.at(-1)?.createdAt ?? '';
			return last > at ? last : at;
		}, c.createdAt);
	return {
		id: raw.id,
		number: raw.number,
		title: raw.title,
		body: raw.body,
		bodyHtml: cleanGithubHtml(raw.bodyHTML),
		url: raw.url,
		author: raw.author?.login ?? 'ghost',
		state: raw.state,
		isDraft: raw.isDraft,
		baseRefName: raw.baseRefName,
		headRefName: raw.headRefName,
		baseRefOid: raw.baseRefOid,
		headRefOid: raw.headRefOid,
		comments: [...raw.comments.nodes.map(comment), ...reviews].sort((a, b) =>
			activity(a).localeCompare(activity(b))
		),
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
		if (!haveHead) await gitFetch(root, ['--quiet', url, `refs/pull/${number}/head`]);
		// the base by its commit, its branch may have been deleted since. GitHub still hands
		// out a commit it has, so only a base that's gone from it fails
		if (!haveBase) await gitFetch(root, ['--quiet', url, pr.baseRefOid]).catch(() => {});
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
	const fields =
		'number,title,author,headRefName,baseRefName,isDraft,updatedAt,reviewDecision,reviewRequests,latestReviews';
	try {
		const [out, me] = await Promise.all([
			gh(root, ['pr', 'list', '--limit', '100', '--json', fields]),
			viewer(root)
		]);
		return (JSON.parse(out) as RawSummary[]).map((p) => toPrSummary(p, me));
	} catch {
		return null;
	}
}

export interface RawSummary extends Omit<
	PrSummary,
	'author' | 'mine' | 'requested' | 'reviewed' | 'reviewDecision'
> {
	author: { login: string } | null;
	reviewDecision: string;
	/** a team's has a slug instead of a login */
	reviewRequests: { login?: string }[];
	latestReviews: { author: { login: string } | null; state: string }[];
}

/** A listed pull request, with where you stand on it worked out for `me`. */
export function toPrSummary(raw: RawSummary, me: string): PrSummary {
	const { reviewRequests, latestReviews, ...rest } = raw;
	const review = latestReviews.find((r) => r.author?.login === me)?.state;
	const author = raw.author?.login ?? 'ghost';
	return {
		...rest,
		author,
		reviewDecision: (raw.reviewDecision || null) as PrSummary['reviewDecision'],
		mine: author === me,
		// ponytail: only requests to you by name, team membership isn't in this data.
		// A second `gh pr list --search review-requested:@me` would add your teams'
		requested: reviewRequests.some((r) => r.login === me),
		reviewed:
			review === 'APPROVED' || review === 'CHANGES_REQUESTED' || review === 'COMMENTED'
				? review
				: null
	};
}

/** The signed-in login, asked once: it doesn't change while the server runs. */
let login: Promise<string> | undefined;
function viewer(root: string): Promise<string> {
	login ??= gh(root, ['api', 'user', '--jq', '.login']).then(
		(out) => out.trim(),
		(error) => {
			// not signed in yet, ask again next time
			login = undefined;
			throw error;
		}
	);
	return login;
}

// ---------------------------------------------------------------------------
// drafts: comments added to your pending review, finished and submitted on GitHub

/** A GraphQL request with its variables as the request body, nothing in them needs escaping. */
async function graphql(root: string, query: string, variables: Record<string, unknown>) {
	const out = await gh(
		root,
		['api', 'graphql', '--input', '-'],
		JSON.stringify({ query, variables })
	);
	const { data, errors } = JSON.parse(out);
	if (errors?.length) throw new Error(errors.map((e: { message: string }) => e.message).join(', '));
	return data;
}

// ponytail: a pending review's first 100 comments are checked for one already there
const PENDING = `query($pr: ID!) {
  node(id: $pr) {
    ... on PullRequest {
      reviews(states: PENDING, first: 1) {
        nodes { id commit { oid } comments(first: 100) { nodes { path body } } }
      }
    }
  }
}`;
const START = `mutation($pr: ID!, $commit: GitObjectID) {
  addPullRequestReview(input: { pullRequestId: $pr, commitOID: $commit }) { pullRequestReview { id } }
}`;
const THREAD = `mutation($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) { thread { id } }
}`;
const REPLY = `mutation($input: AddPullRequestReviewThreadReplyInput!) {
  addPullRequestReviewThreadReply(input: $input) { comment { id } }
}`;

const NODE_ID = /^[A-Za-z0-9_-]{1,100}$/;
// the page names commits by short shas, GitHub takes full ones
const SHA = /^[0-9a-f]{7,40}$/;
// GitHub's own limit on a comment
const MAX_BODY = 65_536;
const LINE = (n: unknown) => n === undefined || (Number.isInteger(n) && (n as number) > 0);

/** Checks a suggestion from the page before it goes anywhere near GitHub. */
export function checkSuggestion(s: Suggestion): Suggestion {
	const valid =
		typeof s?.body === 'string' &&
		s.body.trim() !== '' &&
		s.body.length <= MAX_BODY &&
		(s.kind === 'reply'
			? typeof s.thread === 'string' && NODE_ID.test(s.thread)
			: s.kind === 'review' &&
				typeof s.path === 'string' &&
				s.path !== '' &&
				(s.side === 'old' || s.side === 'new') &&
				LINE(s.line) &&
				LINE(s.startLine) &&
				(s.startLine === undefined || (s.line !== undefined && s.startLine <= s.line)));
	if (!valid) throw new Error('That comment is not one GitHub can take');
	return s;
}

/** The input for a new thread in the review: on lines, or on the whole file without them. */
export function threadInput(review: string, s: Extract<Suggestion, { kind: 'review' }>) {
	const side = s.side === 'old' ? 'LEFT' : 'RIGHT';
	if (s.line === undefined) {
		return { pullRequestReviewId: review, path: s.path, body: s.body, subjectType: 'FILE' };
	}
	return {
		pullRequestReviewId: review,
		path: s.path,
		body: s.body,
		subjectType: 'LINE',
		line: s.line,
		side,
		// one line is no range
		...(s.startLine !== undefined &&
			s.startLine < s.line && { startLine: s.startLine, startSide: side })
	};
}

/** Your pending review on a pull request, as GitHub has it. */
export interface PendingReview {
	id: string;
	/** the head it was started at, its comments are numbered on that */
	commit: string;
	comments: { path: string; body: string }[];
}

/**
 * What adding a comment takes: starting a review, adding it to the pending one, or
 * nothing when it's in there already, so a second click or a card offered again after a
 * reload doesn't post it twice. Lines numbered on another head than the pending review's
 * would land on the wrong ones, so that's turned down.
 */
export function draftStep(
	pending: PendingReview | null,
	commit: string,
	s: Suggestion
): 'start' | 'add' | 'skip' {
	if (!pending) return 'start';
	if (!sameSha(pending.commit, commit)) {
		throw new Error(
			`Your pending review is on an older version of this pull request (${pending.commit.slice(0, 7)}), finish or discard it on GitHub first`
		);
	}
	const body = s.body.trim();
	const there = pending.comments.some(
		(c) => c.body.trim() === body && (s.kind === 'reply' || c.path === s.path)
	);
	return there ? 'skip' : 'add';
}

// one at a time per pull request: two at once would each find no pending review and both
// start one, GitHub turns the second down
const drafting = new Map<string, Promise<unknown>>();

/**
 * Adds a comment to your pending review on the pull request, starting one at `commit`
 * (the head the diff shows) when there's none. Only you see it until you finish the
 * review on GitHub. Returns whether it was added or was there already.
 */
export function addToDraft(
	root: string,
	pr: string,
	commit: string,
	suggestion: Suggestion
): Promise<'added' | 'already'> {
	if (!NODE_ID.test(pr)) throw new Error('Invalid pull request');
	if (!SHA.test(commit)) throw new Error(`Invalid commit: ${commit}`);
	const s = checkSuggestion(suggestion);
	const next = (drafting.get(pr) ?? Promise.resolve()).then(() => draft(root, pr, commit, s));
	drafting.set(
		pr,
		next.catch(() => {})
	);
	return next;
}

async function draft(root: string, pr: string, commit: string, s: Suggestion) {
	// asked every time, a review finished on GitHub since the page loaded is gone
	const found = (await graphql(root, PENDING, { pr })).node?.reviews?.nodes[0];
	const pending: PendingReview | null = found
		? { id: found.id, commit: found.commit?.oid ?? '', comments: found.comments.nodes }
		: null;
	const step = draftStep(pending, commit, s);
	if (step === 'skip') return 'already';
	const review: string =
		pending?.id ??
		(
			await graphql(root, START, {
				pr,
				commit: (await git(root, ['rev-parse', '--verify', `${commit}^{commit}`])).trim()
			})
		).addPullRequestReview.pullRequestReview.id;
	if (s.kind === 'reply') {
		await graphql(root, REPLY, {
			input: { pullRequestReviewId: review, pullRequestReviewThreadId: s.thread, body: s.body }
		});
	} else {
		await graphql(root, THREAD, { input: threadInput(review, s) });
	}
	return 'added';
}
