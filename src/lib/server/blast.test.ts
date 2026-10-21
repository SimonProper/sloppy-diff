import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { createFixture } from './testing/fixture';

vi.mock('$env/dynamic/private', () => ({ env: process.env }));
const { holdCheckout, moveCompileCommands, serverFor, symbolsAt, Where } = await import('./blast');
const { resolveCommit } = await import('./git');

const range = (start: number, end: number) => ({
	start: { line: start, character: 0 },
	end: { line: end, character: 1 }
});
const symbol = (name: string, kind: number, start: number, end: number, children = []) => ({
	name,
	kind,
	range: range(start, end),
	selectionRange: range(start, start),
	children
});

describe('the declarations selected lines are in', () => {
	// class Cart (5) { total() (6) { const sum (13) } ; items (8) } ; function free (12)
	const symbols = [
		{
			...symbol('Cart', 5, 0, 20),
			children: [
				{ ...symbol('total', 6, 2, 8), children: [symbol('sum', 13, 3, 3)] },
				symbol('items', 8, 10, 10)
			]
		},
		symbol('free', 12, 22, 25)
	];
	const names = (lines: number[]) => symbolsAt(symbols as never, lines).map((s) => s.name);

	test('a line in a method is the method, not a local in it', () => {
		expect(names([3])).toEqual(['total']);
	});

	test('a line between members is the class, and lines across members are each', () => {
		expect(names([9])).toEqual(['Cart']);
		expect(names([4, 10, 23])).toEqual(['total', 'items', 'free']);
	});

	test('lines outside any declaration have none, and a declaration counts once', () => {
		expect(names([21])).toEqual([]);
		expect(names([22, 23, 24])).toEqual(['free']);
	});

	test('never a namespace, and a wrapper is looked into', () => {
		const wrapped = [{ ...symbol('fmt', 3, 0, 30), children: symbols }];
		expect(symbolsAt(wrapped as never, [21, 3]).map((s) => s.name)).toEqual(['total']);
		const script = wrapped[0];
		expect(
			symbolsAt(wrapped as never, [21], (s) => s === (script as never)).map((s) => s.name)
		).toEqual([]);
	});

	test('the way each line was read, for the reader to check', () => {
		const trace: string[] = [];
		symbolsAt(symbols as never, [3, 21], undefined, trace);
		expect(trace).toEqual([
			'4: Cart (class) › total (method) ✓ › sum (variable)',
			'22: no declaration'
		]);
	});

	test('flat symbols from servers that do not nest', () => {
		const flat = [
			{ name: 'Cart', kind: 5, location: { uri: 'file:///a', range: range(0, 20) } },
			{ name: 'total', kind: 6, location: { uri: 'file:///a', range: range(2, 8) } }
		];
		expect(symbolsAt(flat as never, [5]).map((s) => s.name)).toEqual(['total']);
	});
});

test('which language server reads a file', () => {
	expect(['a.ts', 'b.tsx', 'c.mjs', 'd.svelte', 'e.cpp', 'f.h', 'g.py'].map(serverFor)).toEqual([
		'typescript',
		'typescript',
		'typescript',
		'svelte',
		'clangd',
		'clangd',
		null
	]);
});

describe('compile commands for the analysis checkout', () => {
	const root = '/src/repo';
	const dir = '/guides/repo/analysis';
	const entry = {
		directory: '/src/repo/build',
		command:
			'/usr/bin/c++ -I/src/repo/include -I/src/repo/build/gen -I/src/repo-other/include -c /src/repo/src/a.cc',
		file: '/src/repo/src/a.cc',
		output: 'CMakeFiles/a.o'
	};

	test('sources move to the checkout, the build folder and other repos stay', () => {
		const [moved] = JSON.parse(moveCompileCommands(JSON.stringify([entry]), root, dir));
		expect(moved).toEqual({
			directory: '/src/repo/build',
			command:
				'/usr/bin/c++ -I/guides/repo/analysis/include -I/src/repo/build/gen -I/src/repo-other/include -c /guides/repo/analysis/src/a.cc',
			file: '/guides/repo/analysis/src/a.cc',
			output: 'CMakeFiles/a.o'
		});
	});

	test('arguments move too, and a build outside the repo leaves nothing to keep', () => {
		const args = {
			directory: '/out',
			arguments: ['c++', '-I/src/repo/include', '/src/repo/a.cc'],
			file: '/src/repo/a.cc'
		};
		const [moved] = JSON.parse(moveCompileCommands(JSON.stringify([args]), root, dir));
		expect(moved.arguments).toEqual(['c++', `-I${dir}/include`, `${dir}/a.cc`]);
		expect(moved.directory).toBe('/out');
	});

	test('the build folder is where the commands run, not where the file was copied to', () => {
		// next to the sources of a project in the repo, built in its build folder
		const commands = ['a', 'b'].map((name) => ({
			directory: `/src/repo/core/build/${name}`,
			command: `c++ -I/src/repo/core/build/gen -c /src/repo/core/${name}.cc`,
			file: `/src/repo/core/${name}.cc`
		}));
		const moved = JSON.parse(moveCompileCommands(JSON.stringify(commands), root, dir));
		expect(moved[0]).toEqual({
			directory: '/src/repo/core/build/a',
			command: `c++ -I/src/repo/core/build/gen -c ${dir}/core/a.cc`,
			file: `${dir}/core/a.cc`
		});
	});

	test('the working tree itself is left as it is', () => {
		const text = JSON.stringify([entry]);
		expect(moveCompileCommands(text, root, root)).toBe(text);
	});
});

test('threads at one commit share the checkout, one at another waits for them', async () => {
	const fixture = createFixture();
	const guides = mkdtempSync(join(tmpdir(), 'sloppy-diff-guides-'));
	process.env.GUIDES_DIR = guides;
	const head = (dir: string) =>
		execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
	const report = { status() {}, step() {} };
	const go = new AbortController().signal;
	try {
		const [main, change] = await Promise.all(
			['main', 'change'].map((ref) => resolveCommit(fixture.root, ref))
		);
		const first = await holdCheckout(fixture.root, change, report, go);
		const second = await holdCheckout(fixture.root, change, report, go);
		expect(second.dir).toBe(first.dir);

		let moved = false;
		const other = holdCheckout(fixture.root, main, report, go).then((hold) => {
			moved = true;
			return hold;
		});
		first.release();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(moved).toBe(false);
		expect(head(first.dir)).toMatch(new RegExp(`^${change}`));
		second.release();
		const third = await other;
		expect(head(third.dir)).toMatch(new RegExp(`^${main}`));

		// stopped while it waits
		const stop = new AbortController();
		const waiting = holdCheckout(fixture.root, change, report, stop.signal);
		stop.abort();
		await expect(waiting).rejects.toThrow();
		third.release();
	} finally {
		delete process.env.GUIDES_DIR;
		rmSync(guides, { recursive: true, force: true });
		fixture.cleanup();
	}
});

test("a use counts in the repo's own files, not in generated ones or outside it", async () => {
	const dir = mkdtempSync(join(tmpdir(), 'sloppy-diff-where-'));
	try {
		const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
		git('init', '-q');
		writeFileSync(join(dir, '.gitignore'), 'build/\n');
		writeFileSync(join(dir, 'kept.ts'), '');
		git('add', '.');
		git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one');
		// new and not ignored, as an uncommitted change has it, and generated
		writeFileSync(join(dir, 'new.ts'), '');
		mkdirSync(join(dir, 'build'));
		writeFileSync(join(dir, 'build', 'out.js'), '');

		const where = new Where(dir, []);
		const at = (path: string) => where.path(pathToFileURL(join(dir, path)).href);
		expect(await at('kept.ts')).toBe('kept.ts');
		expect(await at('new.ts')).toBe('new.ts');
		expect(await at('build/out.js')).toBeNull();
		expect(await where.path(pathToFileURL('/elsewhere/x.ts').href)).toBeNull();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
