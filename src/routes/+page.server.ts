import { env } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';
import { parseDiff } from '$lib/diff/parse';
import { lineStats } from '$lib/diff/hunks';
import type { Layout } from '$lib/diff/split';
import type { ChangeMode, DiffFile } from '$lib/diff/types';
import type { Scope, Thread } from '$lib/ask/types';
import type { Guide } from '$lib/guide/types';
import type { Branch, Commit, CommitInfo } from '$lib/refs';
import {
	branchBase,
	commitInfo,
	describeBranch,
	commitsInRange,
	emptyTree,
	recentCommits,
	currentBranch,
	defaultBranch,
	errorMessage,
	formerTips,
	isDefaultBranch,
	listBranches,
	listCommits,
	nearestBranch,
	readDiff,
	repoRoot,
	resolveCommit,
	resolveStart,
	type BranchInfo
} from '$lib/server/git';
import { dev } from '$app/environment';
import { cachedDiff, clearDiffs, remember, repoVersion, storeDiff } from '$lib/server/cache';
import { annotateChanges, type ChangeSummary } from '$lib/server/changes';
import { guideEndingAt, listGuides, loadGuide, prepareGuide } from '$lib/server/guides';
import { highlightFile } from '$lib/server/highlight';
import { loadThreads, prepareThreads } from '$lib/server/threads';
import { Timing } from '$lib/server/timing';
import type { PageServerLoad } from './$types';

// in dev this module runs again whenever it or what it imports (the diff engine) is
// edited, and kept diffs were built by the code as it was before
if (dev) clearDiffs();

/**
 * What is being compared:
 * - branch: `branch` from where it split off the branch it was taken from to
 *   its last commit, optionally narrowed to `commits=<first>..<last>` (inclusive)
 * - commit: exactly what one commit changed, from its first parent to it,
 *   stepped through along the branch `on` (found from the commit when not given)
 * - range: `from` to `to`, any two revisions
 * - worktree: uncommitted changes against `from` (HEAD by default)
 */
type Mode = 'branch' | 'commit' | 'range' | 'worktree';

interface BranchSelection extends BranchInfo {
	/** narrowed span, null when the whole branch is shown */
	first: string | null;
	last: string | null;
}

/** The commits a single commit is stepped through along, the lane it's on. */
interface Lane {
	name: string;
	/** the branch it split off, null for the default branch */
	base: string | null;
	/** its own commits, oldest first */
	commits: Commit[];
	/** before it split off, newest first */
	earlier: Commit[];
}

interface Selection {
	/** revisions handed to git diff, an empty `to` is the working tree */
	from: string;
	to: string;
	/** resolved shas, null for the working tree */
	range: { from: string; to: string } | null;
	branch: BranchSelection | null;
	commit: CommitInfo | null;
	/** the branch a single commit is shown on */
	on: string | null;
}

const CHANGE_MODES: ChangeMode[] = ['lines', 'tokens'];

export const load: PageServerLoad = async ({ url, cookies, setHeaders }) => {
	const timing = new Timing();
	const report = () => setHeaders({ 'server-timing': timing.header() });

	const param = (key: string) => url.searchParams.get(key) ?? '';
	const inputs = {
		from: param('from'),
		to: param('to'),
		branch: param('branch'),
		commits: param('commits'),
		commit: param('commit'),
		on: param('on')
	};
	const repo = param('repo') || env.REPO || process.cwd();
	const mode: Mode = inputs.branch
		? 'branch'
		: inputs.commit
			? 'commit'
			: inputs.to
				? 'range'
				: 'worktree';
	const view: 'files' | 'guide' = param('view') === 'guide' ? 'guide' : 'files';
	// how changes within lines are shown, remembered across visits by a cookie
	const requested = param('changes') || cookies.get('changes') || 'lines';
	const changeMode = (CHANGE_MODES as string[]).includes(requested)
		? (requested as ChangeMode)
		: 'lines';
	const layout: Layout = cookies.get('layout') === 'split' ? 'split' : 'unified';
	// saved guides are listed whatever state the current repo is in
	const guides = await timing.measure('guides', listGuides());
	const base = { repo, mode, view, inputs, changeMode, layout, guides };

	let root: string;
	let version: string;
	try {
		root = await timing.measure(
			'root',
			remember(`root\0${repo}`, '', () => repoRoot(repo))
		);
		// branches, commit lists and the like only change when a ref does, so they're
		// reused until then instead of asking git again on every click
		version = await timing.measure('version', repoVersion(root));
	} catch (error) {
		// a repo that moved or was deleted since it was last opened ends up here too
		report();
		return { ...base, ...empty(), error: errorMessage(error) };
	}
	// `name` labels the step in Server-Timing, `detail` narrows the cache key
	const cached = <T>(name: string, compute: () => Promise<T>, detail = '') =>
		timing.measure(name, remember(`${root}\0${name}\0${detail}`, version, compute));

	const head = cached('head', () => Promise.all([currentBranch(root), defaultBranch(root)]));

	// the default branch split off nothing, with nothing unpushed to show its history is
	// stepped through a commit at a time instead, from its last one
	if (mode === 'branch') {
		const [, defaultBase] = await head;
		const name = inputs.branch;
		const base =
			isDefaultBranch(name, defaultBase) &&
			(await cached(
				'base',
				() => branchBase(root, name, defaultBase).catch(() => undefined),
				name
			));
		if (base === null) {
			const to = new URLSearchParams(url.searchParams);
			to.delete('branch');
			to.delete('commits');
			to.set('commit', await resolveCommit(root, name));
			to.set('on', name);
			redirect(307, `${url.pathname}?${to}`);
		}
	}
	const rev = mode === 'commit' ? '' : mode === 'branch' ? inputs.branch : inputs.to;
	const meta = Promise.all([
		cached('branches', () => listBranches(root).catch(() => [])),
		// a single commit can come from any branch, the other modes follow one line of history
		cached(
			'commits',
			() => (mode === 'commit' ? recentCommits(root) : listCommits(root, rev)),
			`${mode === 'commit'}\0${rev}`
		)
	]);

	// the diff doesn't wait for the lists above, both run at once
	const work = head.then(async ([current, defaultBase]) => {
		const selection = await (mode === 'worktree'
			? select(root, mode, inputs, current, defaultBase)
			: cached(
					'select',
					() => select(root, mode, inputs, current, defaultBase),
					`${JSON.stringify(inputs)}\0${current}\0${defaultBase}`
				));
		// shared by every commit on the branch, so stepping through it doesn't redo it
		const on = selection.on;
		const lane = on
			? await cached('lane', () => laneOf(root, on, defaultBase).catch(() => null), on)
			: null;

		// between two fixed commits the finished diff never changes
		const key = selection.range
			? [root, selection.range.from, selection.range.to, changeMode].join('\0')
			: null;
		const hit = key ? cachedDiff<{ files: DiffFile[]; changes: ChangeSummary }>(key) : undefined;
		if (hit) return { selection, lane, ...hit };

		// the resolved shas when there are some, a ref that moved since must not end up
		// cached under the commits it pointed at before
		const [from, to] = selection.range
			? [selection.range.from, selection.range.to]
			: [selection.from, selection.to];
		const files = parseDiff(await timing.measure('diff', readDiff(root, from, to)));
		// spans have to exist before highlighting, they become overlays
		const changes = await timing.measure(`changes-${changeMode}`, async () =>
			annotateChanges(files, changeMode)
		);
		await timing.measure('highlight', async () => void files.forEach(highlightFile));
		if (key) storeDiff(key, { files, changes }, lineStats(files.flatMap((f) => f.hunks)).lines);
		return { selection, lane, files, changes };
	});

	const [lists, result] = await Promise.allSettled([meta, work]);
	const [branch, defaultBase] = await head;
	const [branches, commits] =
		lists.status === 'fulfilled' ? lists.value : [[] as Branch[], [] as Commit[]];
	const context = { ...base, repo: root, branch, defaultBase, branches, commits };

	if (result.status === 'rejected') {
		report();
		return {
			...context,
			selection: null,
			lane: null,
			files: [],
			changes: null,
			guide: null,
			scope: null,
			threads: [] as Thread[],
			error: errorMessage(result.reason)
		};
	}

	const { selection, lane, files, changes } = result.value;
	// questions asked about this diff: the range's, or the working tree's
	const scope: Scope = selection.range
		? `${selection.range.from}..${selection.range.to}`
		: 'worktree';
	const [guide, threads] = await Promise.all([
		timing.measure(
			'guide',
			guideFor(
				root,
				selection.range,
				files,
				selection.branch && !selection.branch.first ? selection.branch.name : null
			)
		),
		timing.measure(
			'threads',
			loadThreads(root, scope).then((t) => prepareThreads(t, files))
		)
	]);
	report();
	return { ...context, selection, lane, files, changes, guide, scope, threads, error: null };
};

async function select(
	root: string,
	mode: Mode,
	inputs: Record<'from' | 'to' | 'branch' | 'commits' | 'commit' | 'on', string>,
	current: string | null,
	defaultBase: string | null
): Promise<Selection> {
	const none = { branch: null, commit: null, on: null };
	if (mode === 'worktree') {
		// a repository without commits yet compares its files against nothing
		const from = inputs.from || ((await hasCommits(root)) ? 'HEAD' : await emptyTree(root));
		return { from, to: '', range: null, ...none };
	}

	if (mode === 'commit') {
		// one git call has the commit and its parents, shortened like resolveCommit does
		const commit = await commitInfo(root, inputs.commit);
		const to = commit.hash.slice(0, 12);
		// a merge is shown against the line it was merged into, the first commit against nothing
		const [from, on] = await Promise.all([
			commit.parentHashes.length ? commit.parentHashes[0].slice(0, 12) : emptyTree(root),
			inputs.on || nearestBranch(root, commit.hash, defaultBase, [current]).catch(() => null)
		]);
		return { from, to, range: { from, to }, branch: null, commit, on };
	}

	if (mode === 'range') {
		const from = inputs.from || 'HEAD';
		const [fromSha, toSha] = await Promise.all([
			resolveStart(root, from),
			resolveCommit(root, inputs.to)
		]);
		return { from, to: inputs.to, range: { from: fromSha, to: toSha }, ...none };
	}

	const about = await describeBranch(root, inputs.branch, defaultBase);
	const commits = about.commits;

	// narrow to an inclusive span of the branch's commits
	const [a, b] = inputs.commits.split('..');
	const index = (sha?: string) =>
		sha ? commits.findIndex((c) => c.sha.startsWith(sha) || sha.startsWith(c.sha)) : -1;
	let [i, j] = [index(a), index(b || a)];
	if (i > j) [i, j] = [j, i];

	if (i >= 0) {
		const [from, to] = await Promise.all([
			resolveCommit(root, `${commits[i].sha}^`),
			resolveCommit(root, commits[j].sha)
		]);
		const range = { from, to };
		return {
			...range,
			range,
			branch: { ...about, first: commits[i].sha, last: commits[j].sha },
			commit: null,
			on: null
		};
	}

	const range = { from: about.mergeBase, to: about.tip };
	return {
		...range,
		range,
		branch: { ...about, first: null, last: null },
		commit: null,
		on: null
	};
}

/** A branch's own commits and what came before, or the default branch's recent history. */
async function laneOf(root: string, name: string, defaultBase: string | null): Promise<Lane> {
	const base = await branchBase(root, name, defaultBase);
	if (!base) {
		// nothing it split off, its recent history is all there is
		return {
			name,
			base: null,
			commits: (await listCommits(root, name, 100)).reverse(),
			earlier: []
		};
	}
	const [commits, earlier] = await Promise.all([
		commitsInRange(root, base.mergeBase, name),
		listCommits(root, base.mergeBase, 50)
	]);
	return { name, base: base.name, commits, earlier };
}

/**
 * The stored guide for exactly this commit range, checked against the diff.
 * For a whole `branch` without one, the guide for where it pointed before, so
 * a guide isn't lost when the branch is rebased or gets another commit.
 */
async function guideFor(
	root: string,
	range: Selection['range'],
	files: DiffFile[],
	branch: string | null
): Promise<Guide | null> {
	// guides cover commit ranges, the working tree has no stable identity
	if (!range) return null;
	const guide = await loadGuide(root, range.from, range.to);
	if (guide) return prepareGuide(guide, files);
	if (!branch) return null;
	const earlier = await guideEndingAt(root, await formerTips(root, branch));
	return earlier && { ...prepareGuide(earlier, files), earlier: true };
}

async function hasCommits(root: string): Promise<boolean> {
	return resolveCommit(root, 'HEAD').then(
		() => true,
		() => false
	);
}

function empty() {
	return {
		branch: null,
		defaultBase: null,
		branches: [],
		commits: [],
		selection: null,
		lane: null,
		files: [],
		changes: null,
		guide: null,
		scope: null,
		threads: [] as Thread[]
	};
}
