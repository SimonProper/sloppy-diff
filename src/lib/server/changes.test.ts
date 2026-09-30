import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseDiff } from '$lib/diff/parse';
import type { ChangeMode } from '$lib/diff/types';
import { annotateChanges } from './changes';
import { createFixture, novel, type Fixture, type Result } from './testing/fixture';

/** The change modes on a fixture repo with one kind of change per file. */

let fixture: Fixture;
const results = {} as Record<ChangeMode, Result>;

beforeAll(async () => {
	fixture = createFixture();
	for (const mode of ['lines', 'tokens'] as const) results[mode] = await fixture.run(mode);
});
afterAll(() => fixture.cleanup());

describe('lines', () => {
	const FILES = ['src/cart.ts', 'src/format.ts', 'src/label.ts', 'NOTES.txt', 'src/util.ts'];
	for (const path of FILES) {
		test(`${path}: whole lines only, nothing highlighted inside them`, () => {
			const f = results.lines.file(path);
			expect(f.changes).toBeFalsy();
			for (const l of f.hunks.flatMap((h) => h.lines)) {
				expect(l.spans).toBeFalsy();
				expect(l.reformatted).toBeFalsy();
				expect(l.html ?? '').not.toContain('novel');
			}
		});
	}
});

describe('tokens', () => {
	const line = (path: string, kind: 'add' | 'del', text: string) =>
		results.tokens.line(path, kind, text);

	test('src/cart.ts: the rename highlights only qty and quantity', () => {
		expect(novel(line('src/cart.ts', 'del', 'qty: number'))).toEqual(['qty']);
		expect(novel(line('src/cart.ts', 'add', 'quantity: number'))).toEqual(['quantity']);
		expect(novel(line('src/cart.ts', 'del', 'item.qty, 0'))).toEqual(['qty']);
		expect(novel(line('src/cart.ts', 'add', 'item.quantity, 0'))).toEqual(['quantity']);
	});

	test('src/cart.ts: the highlight is an overlay that keeps syntax colours', () => {
		const html = line('src/cart.ts', 'add', 'quantity: number').html ?? '';
		expect(html).toContain('<span class="tok novel">');
		expect(html).toMatch(/class="tok [a-z_]+">quantity</);
	});

	test('src/cart.ts: describe() moving to the top is a removal and an addition', () => {
		expect(line('src/cart.ts', 'add', 'export function describe').reformatted).toBeUndefined();
		expect(line('src/cart.ts', 'del', 'export function describe').reformatted).toBeUndefined();
	});

	test('src/cart.ts: is not formatting only', () => {
		expect(results.tokens.file('src/cart.ts').changes).toEqual({ formattingOnly: false });
	});

	test('src/format.ts: the re-wrap counts as formatting only', () => {
		const f = results.tokens.file('src/format.ts');
		expect(f.changes?.formattingOnly).toBe(true);
		const changed = f.hunks.flatMap((h) => h.lines).filter((l) => l.kind !== 'ctx');
		expect(changed.every((l) => l.reformatted)).toBe(true);
	});

	test('src/label.ts: highlights exactly 1 and 2 after the multi-byte text', () => {
		expect(novel(line('src/label.ts', 'del', 'count = 1'))).toEqual(['1']);
		expect(novel(line('src/label.ts', 'add', 'count = 2'))).toEqual(['2']);
	});

	test('NOTES.txt: highlights the new words', () => {
		expect(novel(line('NOTES.txt', 'add', 'Release notes'))).toEqual(['(draft)']);
		expect(novel(line('NOTES.txt', 'add', 'Added'))).toEqual(['line item']);
	});

	test('src/util.ts: the re-indented return has nothing new, the if around it is new', () => {
		expect(line('src/util.ts', 'del', 'return Math.min').reformatted).toBe(true);
		expect(line('src/util.ts', 'add', 'return Math.min').reformatted).toBe(true);
		expect(line('src/util.ts', 'add', 'Number.isFinite').reformatted).toBeUndefined();
		expect(line('src/util.ts', 'add', 'return min;').reformatted).toBeUndefined();
	});

	test('src/util.ts: is not formatting only', () => {
		expect(results.tokens.file('src/util.ts').changes).toEqual({ formattingOnly: false });
	});
});

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
		expect(file.changes).toEqual({ formattingOnly: true });
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
		expect(line('add', 'const s').reformatted).toBeFalsy();
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
		expect(line('add', 'b()').reformatted).toBeFalsy();
		expect(novel(line('add', 'b()'))).toEqual(['    ']);
	});

	test('a python line with a new argument highlights just that', () => {
		const { line } = tokens('f.py', `@@ -1,2 +1,2 @@\n x()\n-\tb)\n+\ta, b)\n`);
		expect(novel(line('add', 'a, b'))).toEqual(['a,']);
	});
});

describe('within a block', () => {
	test('a line stitched from two removed lines keeps what came from the second', () => {
		const { line } = tokens(
			'f.ts',
			`@@ -1,2 +1 @@\n-if (isAdmin(user)) allow();\n-if (isGuest(user)) deny();\n+if (isAdmin(user)) deny();\n`
		);
		const added = line('add', 'isAdmin');
		expect(added.reformatted).toBeFalsy();
		expect(novel(added)).toEqual(['deny();']);
	});

	test('lines swapped within a block are not reformatted', () => {
		const { file, line } = tokens(
			'f.ts',
			`@@ -1,2 +1,2 @@\n-const alphabetical = sortEverything(items);\n-const broadcasted = sendEverywhere(items);\n+const broadcasted = sendEverywhere(items);\n+const alphabetical = sortEverything(items);\n`
		);
		expect(file.changes?.formattingOnly).toBe(false);
		expect(
			line('add', 'alphabetical').reformatted && line('add', 'broadcasted').reformatted
		).toBeFalsy();
	});

	test('markup wrapped in a new element highlights only what is new', () => {
		const { line } = tokens(
			'Field.svelte',
			[
				'@@ -1,3 +1,5 @@',
				'-<div class="relative my-2 {div_css}">',
				'-    <label class="whitespace-nowrap">{label}</label>',
				'+<div class="relative {div_css}">',
				'+    {#if label}',
				'+        <div class="flex items-center gap-1 py-1">',
				'+            <label for={id} class="whitespace-nowrap">{label}</label>',
				'     <slot />'
			].join('\n') + '\n'
		);
		const label = line('add', '<label');
		expect(novel(label)).toContain('for={id}');
		expect(novel(label).join('')).not.toContain('whitespace-nowrap');
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

describe('moved code', () => {
	test('a block moved further down is a removal and an addition', () => {
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
		const { file, line } = tokens('f.ts', body + '\n');
		for (const kind of ['del', 'add'] as const) {
			expect(line(kind, 'export function').reformatted).toBeFalsy();
			// the whole line is new, the row colour says so
			expect(line(kind, 'export function').spans).toBeUndefined();
		}
		expect(file.changes?.formattingOnly).toBe(false);
	});
});
