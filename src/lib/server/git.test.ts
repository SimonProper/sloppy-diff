import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { branchBase, formerTips, nearestBranch, resolveCommit } from './git';

interface Repo {
	root: string;
	git: (...args: string[]) => string;
	/** git as of `seconds` since the epoch, which is what its reflogs record */
	at: (seconds: number, ...args: string[]) => string;
	commit: (message: string) => string;
	sha: (rev: string) => Promise<string>;
}
const repos: Repo[] = [];
afterAll(() => repos.forEach((r) => rmSync(r.root, { recursive: true, force: true })));

/**
 * A repo of its own for every group of tests, so none depends on what
 * another added:
 *
 * main ── m1 ── m2 ── merge(done) ── m3
 *          │  └─ sibling ─ s1    │
 *          ├─ feature ─ f1 ── f2 │
 *          │           └─ stacked ─ k1
 *          └─ done ─ d1 ─────────┘
 */
function graph(): Repo {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-git-')));
	const run = (args: string[], env: Record<string, string> = {}) =>
		execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
			cwd: root,
			stdio: 'pipe',
			env: { ...process.env, ...env }
		})
			.toString()
			.trim();
	const git = (...args: string[]) => run(args);
	const at = (seconds: number, ...args: string[]) =>
		run(args, { GIT_COMMITTER_DATE: `@${seconds} +0000` });
	const commit = (message: string) => git('commit', '-q', '--allow-empty', '-m', message);
	const repo: Repo = { root, git, at, commit, sha: (rev) => resolveCommit(root, rev) };
	repos.push(repo);

	git('init', '-q', '-b', 'main');
	commit('m1');
	git('tag', 'm1');
	git('checkout', '-q', '-b', 'feature');
	commit('f1');
	git('tag', 'f1');
	commit('f2');
	git('checkout', '-q', '-b', 'stacked', 'f1');
	commit('k1');
	git('checkout', '-q', '-b', 'done', 'main');
	commit('d1');
	git('checkout', '-q', 'main');
	commit('m2');
	git('tag', 'm2');
	git('checkout', '-q', '-b', 'sibling');
	commit('s1');
	git('checkout', '-q', 'main');
	git('merge', '-q', '--no-ff', '-m', 'merge done', 'done');
	commit('m3');
	return repo;
}

describe('branchBase', () => {
	let r: Repo;
	beforeAll(() => {
		r = graph();
	});

	test('a branch taken off main is compared against main', async () => {
		expect(await branchBase(r.root, 'feature', 'main')).toEqual({
			name: 'main',
			mergeBase: await r.sha('m1'),
			merged: false
		});
	});

	test('a branch taken off another feature branch is compared against that branch', async () => {
		expect(await branchBase(r.root, 'stacked', 'main')).toEqual({
			name: 'feature',
			mergeBase: await r.sha('f1'),
			merged: false
		});
	});

	test('a later branch sharing the same history loses to the default branch', async () => {
		// sibling contains m1 like main does, so both are equally close
		expect((await branchBase(r.root, 'feature', 'main'))?.name).toBe('main');
		expect(await branchBase(r.root, 'sibling', 'main')).toEqual({
			name: 'main',
			mergeBase: await r.sha('m2'),
			merged: false
		});
	});

	test('a merged branch is compared against where it split off before the merge', async () => {
		expect(await branchBase(r.root, 'done', 'main')).toEqual({
			name: 'main',
			mergeBase: await r.sha('m1'),
			merged: true
		});
	});

	test('a branch with nothing of its own shows its last commit', async () => {
		// taken off main's tip, or fast-forwarded into it: main contains all of it
		r.git('branch', 'fresh', 'main');
		r.git('branch', 'old', 'm2');
		expect(await branchBase(r.root, 'fresh', 'main')).toEqual({
			name: 'main',
			mergeBase: await r.sha('main^'),
			merged: false
		});
		expect((await branchBase(r.root, 'old', 'main'))?.mergeBase).toBe(await r.sha('m1'));
	});

	test('the default branch has nothing to compare against without a remote', async () => {
		expect(await branchBase(r.root, 'main', 'main')).toBeNull();
	});
});

describe('branchBase with branches merged in', () => {
	test('a branch merged into another is not its base', async () => {
		// combined starts off feature at f1 and has sibling merged into it, sibling
		// shares more history but forks off the merged-in side, not combined's own line
		const r = graph();
		r.git('checkout', '-q', '-b', 'combined', 'f1');
		r.git('merge', '-q', '--no-ff', '-m', 'merge sibling', 'sibling');
		expect(await branchBase(r.root, 'combined', 'main')).toEqual({
			name: 'feature',
			mergeBase: await r.sha('f1'),
			merged: false
		});
	});

	test('a branch that merged the default branch in to catch up is still compared against it', async () => {
		// catchup starts at m2, main moves on, catchup merges main back in and carries on
		const r = graph();
		r.git('checkout', '-q', '-b', 'catchup', 'm2');
		r.commit('c1');
		r.git('checkout', '-q', 'main');
		r.commit('m4');
		r.git('checkout', '-q', 'catchup');
		r.git('merge', '-q', '--no-ff', '-m', 'merge main', 'main');
		r.commit('c2');
		expect(await branchBase(r.root, 'catchup', 'main')).toEqual({
			name: 'main',
			mergeBase: await r.sha('main'),
			merged: false
		});
	});
});

describe('with remotes', () => {
	let r: Repo;
	beforeAll(() => {
		r = graph();
		// origin is behind on main and has an older copy of feature
		r.git('update-ref', 'refs/remotes/origin/main', 'm2');
		r.git('update-ref', 'refs/remotes/origin/feature', 'f1');
	});

	test("a branch's own copy on a remote isn't its base", async () => {
		expect((await branchBase(r.root, 'feature', 'origin/main'))?.name).toBe('main');
	});

	test('the default branch is compared against what is pushed', async () => {
		expect(await branchBase(r.root, 'main', 'origin/main')).toEqual({
			name: 'origin/main',
			mergeBase: await r.sha('m2'),
			merged: false
		});
	});

	test('a branch taken off the pushed copy is not its base once it moves on', async () => {
		// sibling is pushed at s1, next is taken off origin/sibling, then sibling is
		// checked out again from origin and gets s2: its reflog starts where next's does
		const r = graph();
		r.at(1, 'update-ref', 'refs/remotes/origin/sibling', 'sibling');
		r.at(2, 'branch', 'next', 'origin/sibling');
		r.git('branch', '-D', 'sibling');
		r.at(3, 'checkout', '-q', '-b', 'sibling', 'origin/sibling');
		r.commit('s2');
		expect(await branchBase(r.root, 'sibling', 'main')).toEqual({
			name: 'main',
			mergeBase: await r.sha('m2'),
			merged: false
		});
	});

	test('a branch taken off the pushed copy is not its base when only on a remote either', async () => {
		// next is taken off origin/sibling, gets n1 and is pushed, then only its copy on
		// origin is left, and sibling gets s2
		const r = graph();
		r.at(1, 'update-ref', 'refs/remotes/origin/sibling', 'sibling');
		r.at(2, 'checkout', '-q', '-b', 'next', 'origin/sibling');
		r.commit('n1');
		r.at(3, 'update-ref', 'refs/remotes/origin/next', 'next');
		r.git('checkout', '-q', 'sibling');
		r.git('branch', '-D', 'next');
		r.commit('s2');
		expect(await branchBase(r.root, 'sibling', 'main')).toEqual({
			name: 'main',
			mergeBase: await r.sha('m2'),
			merged: false
		});
	});

	test('a branch taken off one only on a remote is compared against it', async () => {
		const r = graph();
		r.git('checkout', '-q', '-b', 'theirs', 'main');
		r.commit('t1');
		r.at(1, 'update-ref', 'refs/remotes/origin/theirs', 'theirs');
		r.git('checkout', '-q', 'main');
		r.git('branch', '-D', 'theirs');
		r.at(2, 'checkout', '-q', '-b', 'mine', 'origin/theirs');
		r.commit('y1');
		expect(await branchBase(r.root, 'mine', 'main')).toEqual({
			name: 'origin/theirs',
			mergeBase: await r.sha('origin/theirs'),
			merged: false
		});
	});

	test('a local copy wins over an equally close remote one', async () => {
		expect((await branchBase(r.root, 'stacked', 'origin/main'))?.name).toBe('feature');
	});

	test('a commit is on a local branch rather than its copy on a remote', async () => {
		// f1 is as near feature's tip as stacked's, and origin/feature points right at it
		expect(await nearestBranch(r.root, 'f1', 'main', ['feature'])).toBe('feature');
		expect(await nearestBranch(r.root, 'f1', 'main', ['stacked'])).toBe('stacked');
	});

	test('the default branch named by its remote still means the local copy', async () => {
		expect(await nearestBranch(r.root, 'm1', 'origin/main')).toBe('main');
	});
});

test('a rebased branch still knows where it pointed before', async () => {
	const r = graph();
	const before = r.git('rev-parse', 'feature');
	r.git('rebase', '-q', 'main', 'feature');
	const tips = await formerTips(r.root, 'feature');
	expect(tips[0]).toBe(r.git('rev-parse', 'feature'));
	expect(tips).toContain(before);
});

describe('nearestBranch', () => {
	let r: Repo;
	beforeAll(() => {
		r = graph();
	});

	test('a commit on main belongs to main, even where a branch was taken off it', async () => {
		expect(await nearestBranch(r.root, 'm1', 'main')).toBe('main');
		expect(await nearestBranch(r.root, 'm2', 'main')).toBe('main');
	});

	test('a commit made on a branch belongs to it, merged or not', async () => {
		expect(await nearestBranch(r.root, 'feature', 'main')).toBe('feature');
		expect(await nearestBranch(r.root, 'stacked', 'main')).toBe('stacked');
		expect(await nearestBranch(r.root, 'done', 'main')).toBe('done');
	});

	test('ties go to the preferred branch', async () => {
		expect(await nearestBranch(r.root, 'f1', 'main', ['stacked'])).toBe('stacked');
	});
});
