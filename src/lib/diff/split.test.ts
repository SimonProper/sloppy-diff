import { describe, expect, test } from 'vitest';
import { parseDiff } from './parse';
import { splitRows } from './split';

/** Rows as "left | right" text, _ for an empty side. */
function rows(patch: string): string[] {
	const [file] = parseDiff(patch);
	return splitRows(file.hunks[0]).map(
		({ left, right }) => `${left ? left.text : '_'} | ${right ? right.text : '_'}`
	);
}

const header = 'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n';

describe('splitRows', () => {
	test('puts context on both sides and pairs a changed line with its replacement', () => {
		expect(rows(`${header}@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n`)).toEqual(['a | a', 'b | B', 'c | c']);
	});

	test('lets the longer side of a run continue alone', () => {
		expect(rows(`${header}@@ -1,3 +1,2 @@\n-x\n-y\n-z\n+X\n a\n`)).toEqual([
			'x | X',
			'y | _',
			'z | _',
			'a | a'
		]);
		expect(rows(`${header}@@ -1,1 +1,3 @@\n+new\n+lines\n a\n`)).toEqual([
			'_ | new',
			'_ | lines',
			'a | a'
		]);
	});

	test('never pairs lines across context', () => {
		expect(rows(`${header}@@ -1,2 +1,2 @@\n-a\n b\n+c\n`)).toEqual(['a | _', 'b | b', '_ | c']);
	});
});
