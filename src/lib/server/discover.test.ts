import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-scan-')));

vi.mock('$env/dynamic/private', () => ({
	env: { ...process.env, REPO_ROOTS: root, REPO_SCAN_DEPTH: '4' }
}));

const { scanRepos } = await import('./discover');

/** A folder that looks like a repo to the scanner: a .git with HEAD and config. */
function repo(path: string, { branch = 'main', remote = '', active = 0 } = {}) {
	const git = join(root, path, '.git');
	mkdirSync(join(git, 'logs'), { recursive: true });
	writeFileSync(join(git, 'HEAD'), `ref: refs/heads/${branch}\n`);
	writeFileSync(
		join(git, 'config'),
		remote ? `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${remote}\n` : '[core]\n'
	);
	writeFileSync(join(git, 'logs', 'HEAD'), '');
	if (active) {
		const when = new Date(active);
		for (const file of ['HEAD', 'config', 'logs/HEAD']) utimesSync(join(git, file), when, when);
	}
}

function file(path: string, content = '') {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
}

beforeAll(() => {
	repo('code/app', { remote: 'git@github.com:me/app.git', active: Date.now() - 60_000 });
	repo('code/old', { branch: 'legacy', active: Date.UTC(2024, 0, 1) });
	// junk the scan must never report
	repo('code/app/packages/vendored'); // nested inside another repo
	repo('code/site/node_modules/some-dep'); // installed dependency
	repo('.cargo/registry/src/crate'); // hidden tool folder
	repo('code/tool/target/generated'); // build output
	repo('a/b/c/d/too-deep'); // beyond REPO_SCAN_DEPTH
	// a worktree has a .git file pointing at the real git folder
	repo('gitdirs/wt-target', { branch: 'feature' });
	file('code/worktree/.git', `gitdir: ${join(root, 'gitdirs/wt-target/.git')}\n`);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('finds real repositories and none of the junk', async () => {
	const scan = await scanRepos();
	const found = scan.repos.map((r) => r.path.slice(root.length + 1)).sort();
	expect(found).toEqual(['code/app', 'code/old', 'code/worktree', 'gitdirs/wt-target']);
	expect(scan.truncated).toBe(false);
});

test('reads branch, remote and last activity from the .git folder', async () => {
	const { repos } = await scanRepos();
	const app = repos.find((r) => r.name === 'app')!;
	expect(app.branch).toBe('main');
	expect(app.remote).toBe('git@github.com:me/app.git');
	expect(repos.find((r) => r.name === 'old')!.branch).toBe('legacy');
	expect(repos.find((r) => r.name === 'worktree')!.branch).toBe('feature');
});

test('lists the most recently active repositories first', async () => {
	const { repos } = await scanRepos();
	const names = repos.map((r) => r.name);
	expect(names.indexOf('app')).toBeLessThan(names.indexOf('old'));
	expect(names.at(-1)).toBe('old');
});
