import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseDiff } from '$lib/diff/parse';
import type { ChangeMode } from '$lib/diff/types';
import { annotateChanges } from './changes';
import { CHECKS, runCheck } from './testing/checks';
import { createFixture, novel, type Fixture, type Result } from './testing/fixture';

/**
 * Smoke test for the change modes. The checks live in testing/checks.ts and
 * the /smoke page runs the same list, so what passes here is what the page
 * shows as passing.
 */

let fixture: Fixture;
const results = {} as Record<ChangeMode, Result>;

beforeAll(async () => {
	fixture = createFixture();
	for (const mode of ['lines', 'tokens'] as const) results[mode] = await fixture.run(mode);
});
afterAll(() => fixture.cleanup());

for (const mode of ['lines', 'tokens'] as const) {
	describe(mode, () => {
		for (const check of CHECKS.filter((c) => c.mode === mode)) {
			test(`${check.file}: ${check.label}`, () => {
				expect(runCheck(check, results[mode])).toEqual({ status: 'pass' });
			});
		}
	});
}

/** Runs a hand-written patch through the token engine, `file` names its only file. */
function tokens(file: string, body: string) {
	const header = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n`;
	const files = parseDiff(header + body);
	annotateChanges(files, 'tokens');
	const lines = files[0].hunks.flatMap((h) => h.lines);
	const line = (kind: 'add' | 'del', text: string) =>
		lines.find((l) => l.kind === kind && l.text.includes(text))!;
	return { file: files[0], line };
}

describe('formatting only', () => {
	test('a line re-wrapped over two is formatting only', () => {
		const { file } = tokens(
			'f.ts',
			`@@ -1,2 +1,3 @@\n-call(first, second);\n+call(first,\n+\tsecond);\n end();\n`
		);
		expect(file.changes).toEqual({ formattingOnly: true, movedOnly: false });
	});

	test('code moved past other code is not', () => {
		// `a,` ends up after three statements, the order changed
		const { file } = tokens(
			'f.ts',
			`@@ -1,5 +1,5 @@\n-foo(a,\n+foo(\n one();\n two();\n three();\n-\tb);\n+\ta, b);\n`
		);
		expect(file.changes?.formattingOnly).toBe(false);
	});

	test('a guard moved after the call it protects is not', () => {
		const { file } = tokens(
			'f.ts',
			`@@ -1,3 +1,3 @@\n-if (!user) return;\n deleteAll(user);\n+if (!user) return;\n log();\n`
		);
		expect(file.changes?.formattingOnly).toBe(false);
	});

	test('spaces inside a string are part of it', () => {
		const { file, line } = tokens('f.ts', `@@ -1 +1 @@\n-const s = "a  b";\n+const s = "a b";\n`);
		expect(file.changes?.formattingOnly).toBe(false);
		expect(line('add', 'const s').moved).toBeFalsy();
	});

	test('shell words split by a space are not', () => {
		const { file } = tokens('f.sh', `@@ -1 +1 @@\n-rm -rf "$DIR"/cache\n+rm -rf "$DIR" /cache\n`);
		expect(file.changes?.formattingOnly).toBe(false);
	});

	test('plain text without a grammar never is', () => {
		const { file } = tokens('f.txt', `@@ -1 +1 @@\n-a - -b\n+a --b\n`);
		expect(file.changes?.formattingOnly).toBe(false);
	});
});

describe('indentation that carries meaning', () => {
	test('python moving a statement into an if is a change, the indentation highlighted', () => {
		const { file, line } = tokens('f.py', `@@ -1,3 +1,3 @@\n if cond:\n     a()\n-b()\n+    b()\n`);
		expect(file.changes?.formattingOnly).toBe(false);
		expect(line('add', 'b()').moved).toBeFalsy();
		expect(novel(line('add', 'b()'))).toEqual(['    ']);
	});

	test('a python line with a new argument highlights just that', () => {
		const { line } = tokens('f.py', `@@ -1,2 +1,2 @@\n x()\n-\tb)\n+\ta, b)\n`);
		expect(novel(line('add', 'a, b'))).toEqual(['a,']);
	});
});

describe('moved lines', () => {
	test('a line stitched from two removed lines keeps what came from the second', () => {
		const { line } = tokens(
			'f.ts',
			`@@ -1,2 +1 @@\n-if (isAdmin(user)) allow();\n-if (isGuest(user)) deny();\n+if (isAdmin(user)) deny();\n`
		);
		const added = line('add', 'isAdmin');
		expect(added.moved).toBeFalsy();
		expect(novel(added)).toEqual(['deny();']);
	});

	test('a block moved with its leading blank line is still a move', () => {
		const fn = [
			'',
			'export function describe(items: Item[]) {',
			'\treturn items.map(format).join(", ");',
			'}'
		];
		const body = [
			'@@ -1,9 +1,9 @@',
			...fn.map((l) => `-${l}`),
			' const a = 1;',
			' const b = 2;',
			' const c = 3;',
			' const d = 4;',
			' const e = 5;',
			...fn.map((l) => `+${l}`)
		].join('\n');
		const { line } = tokens('f.ts', body + '\n');
		expect(line('del', 'export function').moveLabel).toMatch(/^moved to line \d+$/);
		expect(line('add', 'export function').moveLabel).toMatch(/^moved from line \d+$/);
	});

	test('lines swapped within a block are moves, not re-indentation', () => {
		const { file, line } = tokens(
			'f.ts',
			`@@ -1,2 +1,2 @@\n-const alphabetical = sortEverything(items);\n-const broadcasted = sendEverywhere(items);\n+const broadcasted = sendEverywhere(items);\n+const alphabetical = sortEverything(items);\n`
		);
		expect(file.changes?.formattingOnly).toBe(false);
		expect(line('add', 'alphabetical').moveLabel ?? line('add', 'broadcasted').moveLabel).toMatch(
			/^moved from line \d+$/
		);
	});

	test('a lockfile full of repeated lines stays fast', () => {
		const group = (i: number) => [
			`"pkg-${i}": {`,
			'"dev": true,',
			'"engines": {',
			'"node": ">=12"',
			'}',
			'},'
		];
		const old = Array.from({ length: 3000 }, (_, i) => group(i)).flat();
		const now = Array.from({ length: 3000 }, (_, i) => group(i + 1)).flat();
		const body = [
			`@@ -1,${old.length} +1,${now.length} @@`,
			...old.map((l) => `-${l}`),
			...now.map((l) => `+${l}`)
		];
		const started = performance.now();
		tokens('deps.json', body.join('\n') + '\n');
		expect(performance.now() - started).toBeLessThan(5000);
	});
});
