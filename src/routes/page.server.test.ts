import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createFixture, type Fixture } from '$lib/server/testing/fixture';

// guides go to a folder of the test's own, not the developer's .guides
const guides = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-page-guides-')));
vi.mock('$env/dynamic/private', () => ({ env: { ...process.env, GUIDES_DIR: guides } }));
const { load } = await import('./+page.server');

const fixtures: Fixture[] = [];
afterAll(() => {
	fixtures.forEach((f) => f.cleanup());
	rmSync(guides, { recursive: true, force: true });
});

/** A fixture repo of the test's own, cleaned up afterwards. */
function repo() {
	const fixture = createFixture();
	fixtures.push(fixture);
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: fixture.root, stdio: 'pipe' }).toString().trim();
	return { ...fixture, git };
}

/** Runs the page load like SvelteKit does, headers go through a real Headers object. */
async function run(root: string, query: Record<string, string>) {
	const url = new URL(`http://localhost/?${new URLSearchParams({ repo: root, ...query })}`);
	const headers = new Headers();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const data: any = await (load as any)({
		url,
		cookies: { get: () => undefined },
		setHeaders: (values: Record<string, string>) => {
			for (const [key, value] of Object.entries(values)) headers.set(key, value);
		}
	});
	return { data, headers };
}

const paths = (data: { files: { newPath: string }[] }) => data.files.map((f) => f.newPath).sort();

describe('on the fixture as it is', () => {
	let r: ReturnType<typeof repo>;
	beforeAll(() => {
		r = repo();
	});

	test.each([
		['worktree', {}],
		['branch', { branch: 'change' }],
		['commit', { commit: 'change' }],
		['range', { from: 'main', to: 'change' }]
	])('%s mode loads and reports valid Server-Timing', async (_, query) => {
		const { data, headers } = await run(r.root, query);
		expect(data.error).toBeNull();
		expect(headers.get('server-timing')).toMatch(/total;dur=\d/);
	});

	test('a second visit is served from the caches', async () => {
		await run(r.root, { commit: 'change' });
		const { data, headers } = await run(r.root, { commit: 'change' });
		expect(paths(data)).toEqual([
			'NOTES.txt',
			'src/cart.ts',
			'src/format.ts',
			'src/label.ts',
			'src/util.ts'
		]);
		// the diff itself isn't recomputed, so its steps don't appear
		expect(headers.get('server-timing')).not.toMatch(/\bdiff;/);
	});

	test('a single commit is stepped through along the branch it was made on', async () => {
		const { data } = await run(r.root, { commit: 'change' });
		expect(data.selection.on).toBe('change');
		expect(data.lane).toMatchObject({ name: 'change', base: 'main' });
		expect(data.lane.commits.map((c: { subject: string }) => c.subject)).toEqual(['after']);
		// what came before it split off, to step back into
		expect(data.lane.earlier[0].subject).toBe('before');
	});

	test('a commit on the default branch follows its history', async () => {
		const { data } = await run(r.root, { commit: 'main' });
		expect(data.lane).toMatchObject({ name: 'main', base: null, earlier: [] });
	});

	test('a given branch wins over the one found from the commit', async () => {
		const { data } = await run(r.root, { commit: 'main', on: 'change' });
		expect(data.lane.name).toBe('change');
	});

	test('the first commit can be viewed as a range from nothing', async () => {
		const first = r.git('rev-list', '--max-parents=0', 'main');
		const { data } = await run(r.root, { from: `${first}^`, to: first });
		expect(data.error).toBeNull();
		expect(paths(data)).toContain('src/cart.ts');
	});
});

describe('the caches notice what git changed', () => {
	test('a new commit on the checked-out branch', async () => {
		const r = repo();
		const before = await run(r.root, { branch: 'change' });
		expect(before.data.selection.branch.commits).toHaveLength(1);
		r.write('extra.txt', 'more\n');
		r.commit('another');
		const after = await run(r.root, { branch: 'change' });
		expect(after.data.selection.branch.commits).toHaveLength(2);
	});

	test('a branch in a folder moving while another one is checked out', async () => {
		const r = repo();
		r.git('branch', 'team/topic', 'change');
		const before = await run(r.root, { branch: 'team/topic' });
		expect(before.data.selection.branch.commits).toHaveLength(1);
		r.git('branch', '-f', 'team/topic', 'main');
		const after = await run(r.root, { branch: 'team/topic' });
		// nothing of its own any more, main's last commit is what it shows
		expect(after.data.selection.branch.commits.map((c: { sha: string }) => c.sha)).toEqual([
			r.git('rev-parse', '--short=7', 'main')
		]);
	});

	test('a range to a branch that moved is diffed where the branch is now', async () => {
		const r = repo();
		r.git('branch', 'moving', 'change');
		const before = await run(r.root, { from: 'main', to: 'moving' });
		expect(paths(before.data)).toContain('src/cart.ts');
		r.git('checkout', '-q', '-b', 'other', 'main');
		r.write('only-here.txt', 'x\n');
		r.commit('only here');
		r.git('branch', '-f', 'moving', 'other');
		const after = await run(r.root, { from: 'main', to: 'moving' });
		expect(paths(after.data)).toEqual(['only-here.txt']);
	});
});

test('uncommitted changes include new files, whatever prefixes git is set to use', async () => {
	const r = repo();
	r.git('config', 'diff.mnemonicPrefix', 'true');
	r.write('src/cart.ts', '// edited\n');
	r.write('brand-new.ts', 'export const x = 1;\n');
	const { data } = await run(r.root, {});
	expect(paths(data)).toEqual(['brand-new.ts', 'src/cart.ts']);
	const added = data.files.find((f: { newPath: string }) => f.newPath === 'brand-new.ts');
	expect(added.status).toBe('added');
});

test('a repo that was deleted since it was opened is an error message, not a crash', async () => {
	const r = repo();
	await run(r.root, {});
	r.cleanup();
	const { data } = await run(r.root, {});
	expect(data.error).toMatch(/cannot change to|No such file/);
	expect(data.files).toEqual([]);
});
