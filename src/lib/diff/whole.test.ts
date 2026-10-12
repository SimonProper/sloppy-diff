import { describe, expect, test } from 'vitest';
import { parseDiff } from './parse';
import { gapsOf } from './whole';

const header = 'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n';
const file = (text: string[]) => ({ text, html: text });
const numbered = (lines: { old: number | null; new: number | null; text: string }[]) =>
	lines.map((l) => `${l.old}:${l.new}:${l.text}`);

describe('gapsOf', () => {
	// old: a b c d e f g h, new: a b C d e f g h i (c changed, i added at the end)
	const [diff] = parseDiff(`${header}@@ -3 +3 @@\n-c\n+C\n@@ -8,0 +9 @@\n+i\n`);
	const after = ['a', 'b', 'C', 'd', 'e', 'f', 'g', 'h', 'i'];

	test('fills in the unchanged lines before, between and after hunks, numbered on both sides', () => {
		const gaps = gapsOf(diff.hunks, file(after))!;
		expect(gaps.before.map(numbered)).toEqual([
			['1:1:a', '2:2:b'],
			['4:4:d', '5:5:e', '6:6:f', '7:7:g', '8:8:h']
		]);
		expect(gaps.after).toEqual([]);
	});

	test('shifts the old numbers by what the hunks above added or removed', () => {
		const [d] = parseDiff(`${header}@@ -0,0 +1,2 @@\n+x\n+y\n`);
		expect(numbered(gapsOf(d.hunks, file(['x', 'y', 'a', 'b']))!.after)).toEqual([
			'1:3:a',
			'2:4:b'
		]);
	});

	test('gives up when the file no longer matches the diff', () => {
		expect(gapsOf(diff.hunks, file(['a', 'b', 'c']))).toBeNull();
	});
});
