import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Branch, Commit, CommitInfo } from '$lib/refs';

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await exec('git', ['-C', cwd, ...args], { maxBuffer: 256 * 1024 * 1024 });
	return stdout;
}

// unit separator between fields, one record per line
const SEP = '\x1f';

export async function repoRoot(repo: string): Promise<string> {
	return (await git(repo, ['rev-parse', '--show-toplevel'])).trim();
}

export async function currentBranch(root: string): Promise<string | null> {
	return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).then(
		(b) => b.trim(),
		() => null
	);
}

// the parser expects a/ and b/, whatever diff.mnemonicPrefix or diff.noprefix say
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];

/**
 * Diffs `from` against `to`, both any revision git accepts (`main`, `HEAD~3`,
 * a sha, the empty tree). An empty `to` means the working tree: staged,
 * unstaged and untracked.
 */
export async function readDiff(root: string, from: string, to: string): Promise<string> {
	const revs = [from || 'HEAD', to].filter(Boolean);
	revs.forEach(checkRev);
	const tracked = git(root, [
		'-c',
		'core.quotePath=false',
		'diff',
		...DIFF_FLAGS,
		'--find-renames',
		...revs,
		'--'
	]);
	if (to) return tracked;
	const [changes, added] = await Promise.all([tracked, untracked(root)]);
	return changes + added;
}

/** More new files than this aren't shown, a forgotten build folder shouldn't stall the page. */
const MAX_UNTRACKED = 500;

/** New files git doesn't track yet, as a diff from nothing. */
async function untracked(root: string): Promise<string> {
	const out = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
	const paths = out.split('\0').filter(Boolean).slice(0, MAX_UNTRACKED);
	const diffs: string[] = [];
	// a few at a time, one git process per file
	for (let i = 0; i < paths.length; i += 16) {
		const batch = paths.slice(i, i + 16).map((path) =>
			// --no-index exits with 1 when the files differ, which they always do here
			git(root, [
				'-c',
				'core.quotePath=false',
				'diff',
				'--no-index',
				...DIFF_FLAGS,
				'--',
				'/dev/null',
				path
			]).catch((error) => (error?.code === 1 ? String(error.stdout ?? '') : ''))
		);
		diffs.push(...(await Promise.all(batch)));
	}
	return diffs.join('');
}

/** Local branches, remote branches and tags, most recently touched first. */
export async function listBranches(root: string): Promise<Branch[]> {
	const format = [
		'%(refname)',
		'%(refname:short)',
		'%(objectname:short)',
		'%(HEAD)',
		'%(creatordate:iso-strict)',
		'%(contents:subject)'
	].join(SEP);
	const out = await git(root, [
		'for-each-ref',
		'--sort=-creatordate',
		`--format=${format}`,
		'refs/heads',
		'refs/remotes',
		'refs/tags'
	]);

	return (
		out
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const [ref, name, sha, head, date, subject] = line.split(SEP);
				const kind: Branch['kind'] = ref.startsWith('refs/heads/')
					? 'local'
					: ref.startsWith('refs/tags/')
						? 'tag'
						: 'remote';
				return { name, kind, sha, current: head === '*', date, subject, ref };
			})
			// origin/HEAD is a pointer to another remote branch, not a branch of its own
			.filter((b) => !b.ref.endsWith('/HEAD'))
			.map(({ ref: _, ...branch }) => branch)
	);
}

/** Recent history of `rev`, newest first. */
export async function listCommits(root: string, rev: string, limit = 200): Promise<Commit[]> {
	// straight from the url, `--output=<file>` would have git log overwrite that file
	checkRev(rev || 'HEAD');
	return log(root, [`-n${limit}`, rev || 'HEAD']);
}

/** The newest commits across every branch and tag, for picking a single commit. */
export async function recentCommits(root: string, limit = 300): Promise<Commit[]> {
	return log(root, [`-n${limit}`, '--date-order', 'HEAD', '--branches', '--tags', '--remotes']);
}

async function log(root: string, args: string[]): Promise<Commit[]> {
	const format = ['%h', '%s', '%an', '%cI', '%D', '%p'].join(SEP);
	const out = await git(root, ['log', `--format=${format}`, ...args, '--']).catch(() => '');

	return out
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [sha, subject, author, date, refs, parents] = line.split(SEP);
			return {
				sha,
				subject,
				author,
				date,
				parents: parents ? parents.split(' ') : [],
				refs: refs
					? refs
							.split(', ')
							.map((r) => r.replace(/^HEAD -> /, '').replace(/^tag: /, ''))
							.filter((r) => r !== 'HEAD' && !r.endsWith('/HEAD'))
					: []
			};
		});
}

function checkRev(rev: string) {
	if (!rev || rev.startsWith('-') || /\s/.test(rev)) throw new Error(`Invalid revision: ${rev}`);
}

/** Short but collision-safe sha of the commit `rev` points at. */
export async function resolveCommit(root: string, rev: string): Promise<string> {
	checkRev(rev);
	return (await git(root, ['rev-parse', '--short=12', '--verify', `${rev}^{commit}`])).trim();
}

/** The branch other work is merged into: origin's HEAD, else main, master or trunk. */
export async function defaultBranch(root: string): Promise<string | null> {
	const remote = await git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(
		() => ''
	);
	if (remote.trim()) return remote.trim();
	for (const name of ['main', 'master', 'trunk']) {
		const ok = await git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).then(
			() => true,
			() => false
		);
		if (ok) return name;
	}
	return null;
}

export async function mergeBase(root: string, a: string, b: string): Promise<string | null> {
	return git(root, ['merge-base', a, b]).then(
		(sha) => resolveCommit(root, sha.trim()),
		() => null
	);
}

const MAX_CANDIDATES = 25;

export interface BranchBase {
	/** the branch it split off, for display */
	name: string;
	/** where it split off, what the branch is compared against */
	mergeBase: string;
	/** already merged into `name`, compared against where it split off before the merge */
	merged: boolean;
}

/** `feature` for both refs/heads/feature and refs/remotes/origin/feature. */
function branchPart(ref: string): string {
	return ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '');
}

/**
 * The branch `name` split off, found without being told: of the branches
 * that don't already contain it, the one sharing the most recent history
 * with it, so a branch taken off another feature branch is compared against
 * that branch rather than main. Returns null when there's nothing to compare
 * against, e.g. for the default branch when it's in sync with its remote.
 */
export async function branchBase(
	root: string,
	name: string,
	defaultBase: string | null
): Promise<BranchBase | null> {
	checkRev(name);
	// ahead-behind counts commits only the other ref has, and commits only `name` has
	const format = ['%(refname)', '%(refname:short)', `%(ahead-behind:${name})`].join(SEP);
	const out = await git(root, ['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes']);
	const refs = out
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [ref, short, counts] = line.split(SEP);
			const [ahead, behind] = counts.split(' ').map(Number);
			const local = ref.startsWith('refs/heads/');
			return { ref, short, part: branchPart(ref), local, ahead, behind };
		})
		.filter((r) => !r.ref.endsWith('/HEAD'));
	type Ref = (typeof refs)[number];

	const self = refs.find((r) => r.short === name);
	if (!self) throw new Error(`${name} isn't a branch`);
	const main = refs.find((r) => r.short === defaultBase)?.part;
	const order = (a: Ref, b: Ref) =>
		// the most recent shared history, then the default branch, a local copy,
		// and the branch that moved on the least since
		a.behind - b.behind ||
		Number(b.part === main) - Number(a.part === main) ||
		Number(b.local) - Number(a.local) ||
		a.ahead - b.ahead;

	if (self.part === main) {
		// the default branch split off nothing, the best it can do is what isn't pushed yet
		const upstream = refs.filter((r) => r.part === main && r !== self && r.behind > 0);
		return compareWith(root, name, upstream.sort(order)[0]);
	}
	const into = refs.find((r) => r.part === main && r.behind === 0);
	if (into) return mergedBase(root, name, into.short);

	// its own copies on remotes would only show what isn't pushed
	const candidates = refs.filter((r) => r.part !== self.part && r.behind > 0).sort(order);
	// a branch taken off this one shares as much history with it as its real
	// base does, the reflog tells them apart by where each was created
	const common = (
		await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
	).trim();
	const started = await createdAt(common, self.ref);
	// its own line of work, a branch merged into it forks off somewhere else
	const line = new Set(
		(await git(root, ['rev-list', '--first-parent', '-n5000', name])).split('\n')
	);
	// each candidate costs a few git calls, the right one is almost always near the front.
	// Candidates sharing as much history form a tier, the closest tier decides
	const tiers = new Map<number, Ref[]>();
	for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
		tiers.set(candidate.behind, [...(tiers.get(candidate.behind) ?? []), candidate]);
	}
	for (const tier of tiers.values()) {
		let fallback: { name: string; point: string } | null = null;
		for (const candidate of tier) {
			const other = started && (await createdAt(common, candidate.ref));
			if (other && other !== started && (await isAncestor(root, started, other))) continue;
			const point = (await git(root, ['merge-base', candidate.short, name]).catch(() => '')).trim();
			if (!point) continue;
			if (line.has(point)) {
				return {
					name: candidate.short,
					mergeBase: await resolveCommit(root, point),
					merged: false
				};
			}
			// merging the default branch in to catch up leaves its merge-base on the merged
			// side, what's new since is still what the branch changed. Only when nothing as
			// close forks off the branch's own line, a merged-in sibling would look the same
			if (candidate.part === main) fallback ??= { name: candidate.short, point };
		}
		if (fallback) {
			return {
				name: fallback.name,
				mergeBase: await resolveCommit(root, fallback.point),
				merged: false
			};
		}
	}
	return null;
}

async function compareWith(
	root: string,
	name: string,
	base: { short: string } | undefined
): Promise<BranchBase | null> {
	if (!base) return null;
	const point = await mergeBase(root, base.short, name);
	return point ? { name: base.short, mergeBase: point, merged: false } : null;
}

/** The commit a local branch was created at, from the first line of its reflog. */
async function createdAt(common: string, ref: string): Promise<string | null> {
	if (!ref.startsWith('refs/heads/')) return null;
	const log = await readFile(join(common, 'logs', ref), 'utf8').catch(() => '');
	// "<old sha> <new sha> <who> <when>\t<message>", old is zeros on creation
	const [old, sha] = log.slice(0, log.indexOf('\n')).split(' ');
	return /^0+$/.test(old ?? '') && /^[0-9a-f]{40,64}$/.test(sha ?? '') ? sha : null;
}

async function isAncestor(root: string, ancestor: string, of: string): Promise<boolean> {
	return git(root, ['merge-base', '--is-ancestor', ancestor, of]).then(
		() => true,
		() => false
	);
}

export interface BranchInfo {
	name: string;
	/** the branch it split off, found by looking at the history */
	base: string;
	/** where it split off */
	mergeBase: string;
	/** already merged into its base, shown as it was before the merge */
	merged: boolean;
	tip: string;
	/** oldest first */
	commits: Commit[];
}

/** A branch from where it split off to its tip, what Branch mode and the guide dialog show. */
export async function describeBranch(
	root: string,
	name: string,
	defaultBase: string | null
): Promise<BranchInfo> {
	const [base, tip] = await Promise.all([
		branchBase(root, name, defaultBase),
		resolveCommit(root, name)
	]);
	if (!base) {
		throw new Error(
			name === defaultBase || defaultBase?.endsWith(`/${name}`)
				? `${name} is the default branch and has nothing unpushed, pick a range instead`
				: `Couldn't tell which branch ${name} was taken from, pick a range instead`
		);
	}
	const commits = await commitsInRange(root, base.mergeBase, tip);
	return { name, base: base.name, mergeBase: base.mergeBase, merged: base.merged, tip, commits };
}

/**
 * The branch `rev` belongs to most. The default branch when it's on its own
 * line of work, a commit that was merged in belongs to where it was made.
 * Otherwise, of the branches containing it, the one whose tip it's nearest
 * to, ties going to `prefer` in order and then local branches. Null when no
 * branch contains it.
 */
export async function nearestBranch(
	root: string,
	rev: string,
	defaultBase: string | null,
	prefer: (string | null)[] = []
): Promise<string | null> {
	checkRev(rev);
	const format = ['%(refname)', '%(refname:short)', `%(ahead-behind:${rev})`].join(SEP);
	const out = await git(root, [
		'for-each-ref',
		`--format=${format}`,
		`--contains=${rev}`,
		'refs/heads',
		'refs/remotes'
	]);
	const all = out
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [ref, name, counts] = line.split(SEP);
			const local = ref.startsWith('refs/heads/');
			return { ref, name, part: branchPart(ref), local, ahead: Number(counts.split(' ')[0]) };
		})
		.filter((r) => !r.ref.endsWith('/HEAD'));
	// a remote copy of a local branch is the same branch, the local one stands for both
	const locals = new Set(all.filter((r) => r.local).map((r) => r.part));
	const refs = all.filter((r) => r.local || !locals.has(r.part));

	const main = all.find((r) => r.name === defaultBase)?.part;
	const mainline = refs.find((r) => r.part === main);
	if (mainline && (await onFirstParentLine(root, rev, mainline.name))) return mainline.name;

	const rank = (name: string) => {
		const i = prefer.indexOf(name);
		return i < 0 ? prefer.length : i;
	};
	refs.sort(
		(a, b) => a.ahead - b.ahead || rank(a.name) - rank(b.name) || Number(b.local) - Number(a.local)
	);
	return refs[0]?.name ?? null;
}

/** Whether `rev` was committed on `branch` itself, not on a branch merged into it. */
async function onFirstParentLine(root: string, rev: string, branch: string): Promise<boolean> {
	const [sha, tip] = await Promise.all([
		git(root, ['rev-parse', '--verify', `${rev}^{commit}`]),
		git(root, ['rev-parse', '--verify', `${branch}^{commit}`])
	]).catch(() => ['', '']);
	if (!sha.trim()) return false;
	if (sha.trim() === tip.trim()) return true;
	// first-parent commits of the branch that contain rev, each with its parents
	const after = await git(root, [
		'rev-list',
		'--first-parent',
		'--ancestry-path',
		'--parents',
		`${sha.trim()}..${branch}`
	]).catch(() => '');
	const oldest = after.trim().split('\n').at(-1)?.split(' ') ?? [];
	// the oldest follows rev directly when rev is on the line, else it's the merge that brought it in
	return oldest[1] === sha.trim();
}

/**
 * A branch merged into `into`: compared against where it split off the
 * first-parent line of `into`, just before the merge commit.
 */
async function mergedBase(root: string, name: string, into: string): Promise<BranchBase> {
	// first-parent commits of `into` that contain the branch, the oldest is the merge
	const after = (
		await git(root, ['rev-list', '--first-parent', '--ancestry-path', `${name}..${into}`])
	)
		.split('\n')
		.filter(Boolean);
	const [point, tip] = await Promise.all([
		after.length ? mergeBase(root, `${after.at(-1)}^1`, name) : null,
		resolveCommit(root, name)
	]);
	// fast-forwarded, or simply behind: it has nothing of its own
	if (!point || point === tip) return { name: into, mergeBase: tip, merged: false };
	return { name: into, mergeBase: point, merged: true };
}

/** Commits in start..stop, oldest first. From the empty tree, all of stop's history. */
export async function commitsInRange(root: string, start: string, stop: string): Promise<Commit[]> {
	checkRev(start);
	checkRev(stop);
	const range = (await isEmptyTree(root, start)) ? stop : `${start}..${stop}`;
	return listCommits(root, range, 500).then((c) => c.reverse());
}

/** Messages and file stats of start..stop, oldest first, as context for a guide. */
export async function commitLog(root: string, start: string, stop: string): Promise<string> {
	checkRev(start);
	checkRev(stop);
	const range = (await isEmptyTree(root, start)) ? stop : `${start}..${stop}`;
	return git(root, ['log', '--reverse', '--format=commit %h%n%s%n%n%b', '--stat=100', range, '--']);
}

/** Subject, message, author and parents of one commit. */
export async function commitInfo(root: string, rev: string): Promise<CommitInfo> {
	checkRev(rev);
	const format = ['%h', '%s', '%an', '%cI', '%p', '%H', '%P', '%b'].join(SEP);
	const out = await git(root, ['show', '-s', `--format=${format}`, `${rev}^{commit}`]).catch(() => {
		throw new Error(`No commit named ${rev}`);
	});
	const [sha, subject, author, date, parents, hash, parentHashes, ...body] = out.split(SEP);
	return {
		sha,
		subject,
		author,
		date,
		parents: parents ? parents.split(' ') : [],
		hash,
		parentHashes: parentHashes ? parentHashes.split(' ') : [],
		body: body.join(SEP).trim()
	};
}

/** The empty tree, what a repository's first commit is compared against. */
export async function emptyTree(root: string): Promise<string> {
	return (await git(root, ['hash-object', '-t', 'tree', '/dev/null'])).trim();
}

async function isEmptyTree(root: string, rev: string): Promise<boolean> {
	return /^[0-9a-f]{40,64}$/.test(rev) && rev === (await emptyTree(root));
}

/**
 * Where a range starts: a commit, or the empty tree for everything up to a
 * repository's first commit, given as the empty tree itself or as `<first>^`.
 */
export async function resolveStart(root: string, rev: string): Promise<string> {
	checkRev(rev);
	if (await isEmptyTree(root, rev)) return rev;
	try {
		return await resolveCommit(root, rev);
	} catch (error) {
		const first = rev.endsWith('^') && (await commitInfo(root, rev.slice(0, -1)).catch(() => null));
		if (first && first.parents.length === 0) return emptyTree(root);
		throw error;
	}
}

/** Changes whenever a ref, HEAD or the checked-out branch does. */
export async function refState(root: string): Promise<string> {
	const [refs, head, branch] = await Promise.all([
		// %(symref) catches origin/HEAD pointing elsewhere, which moves the default branch
		git(root, ['for-each-ref', '--format=%(objectname) %(refname) %(symref)']),
		git(root, ['rev-parse', '-q', '--verify', 'HEAD']).catch(() => ''),
		git(root, ['symbolic-ref', '-q', 'HEAD']).catch(() => '')
	]);
	return `${head}${branch}${refs}`;
}

export function errorMessage(error: unknown): string {
	if (error && typeof error === 'object' && 'stderr' in error) {
		const stderr = String(error.stderr).trim();
		if (stderr) return stderr.replace(/^fatal: /, '');
	}
	return error instanceof Error ? error.message : String(error);
}
