import { describe, expect, test } from 'vitest';
import { spanAt } from './hunks';
import { parseDiff } from './parse';

// old: 1 a, 2 b, 3 c, 4 d   new: 1 a, 2 B, 3 c, 4 x, 5 d
const files = parseDiff(
	'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1,4 +1,5 @@\n a\n-b\n+B\n c\n+x\n d\n'
);
const id = files[0].hunks[0].id;

describe('spanAt', () => {
	test('finds a line on the new side', () => {
		expect(spanAt(files, 'f.ts', 'new', 2)).toEqual({ hunk: id, start: 2, end: 2, side: 'new' });
	});

	test('finds a removed line on the old side', () => {
		expect(spanAt(files, 'f.ts', 'old', 2)).toEqual({ hunk: id, start: 1, end: 1, side: 'old' });
	});

	test('spans a range, across the lines of the other side', () => {
		expect(spanAt(files, 'f.ts', 'new', 4, 2)).toEqual({ hunk: id, start: 2, end: 4, side: 'new' });
	});

	test('is null outside the diff, for another file, or for a backwards range', () => {
		expect(spanAt(files, 'f.ts', 'new', 9)).toBeNull();
		expect(spanAt(files, 'g.ts', 'new', 2)).toBeNull();
		expect(spanAt(files, 'f.ts', 'new', 2, 4)).toBeNull();
	});
});
