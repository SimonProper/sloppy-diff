import { describe, expect, test } from 'vitest';
import { parseDiff } from '$lib/diff/parse';
import { commentOn } from './comment';

// old: 1 a, 2 b, 3 c   new: 1 a, 2 B, 3 c, 4 x
const files = parseDiff(
	'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+x\n'
);
const hunk = files[0].hunks[0].id;

describe('commentOn', () => {
	test('numbers picked lines on the new side', () => {
		expect(commentOn(files, { span: { hunk, start: 2, end: 4 } }, 'hm')).toEqual({
			kind: 'review',
			path: 'f.ts',
			side: 'new',
			line: 4,
			startLine: 2,
			body: 'hm'
		});
	});

	test('a single line has no range, a removed one is on the old side', () => {
		expect(commentOn(files, { span: { hunk, start: 1, end: 1 } }, 'hm')).toMatchObject({
			side: 'old',
			line: 2
		});
		expect(commentOn(files, { span: { hunk, start: 2, end: 2 } }, 'hm')).not.toHaveProperty(
			'startLine'
		);
	});

	test('a whole file has no lines, the whole change is no comment', () => {
		expect(commentOn(files, { path: 'f.ts' }, 'hm')).toEqual({
			kind: 'review',
			path: 'f.ts',
			side: 'new',
			body: 'hm'
		});
		expect(commentOn(files, {}, 'hm')).toBeNull();
		expect(commentOn(files, { span: { hunk: 'gone', start: 0, end: 0 } }, 'hm')).toBeNull();
	});
});
