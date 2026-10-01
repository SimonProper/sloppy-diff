import { describe, expect, test } from 'vitest';
import { parseDiff } from '$lib/diff/parse';
import { placeThreads } from './marks';
import type { ReviewThread } from './types';

// old: 1 a, 2 b, 3 c   new: 1 a, 2 B, 3 c, 4 x
const [file] = parseDiff(
	'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+x\n'
);
const id = file.hunks[0].id;

const thread = (over: Partial<ReviewThread>): ReviewThread => ({
	id: 'T',
	path: 'f.ts',
	file: false,
	line: 2,
	startLine: null,
	side: 'new',
	isResolved: false,
	isOutdated: false,
	diffHunk: '',
	comments: [],
	...over
});

describe('placeThreads', () => {
	test('marks every new-side line of a range, the threads on its last one', () => {
		const t = thread({ line: 4, startLine: 2 });
		const { marks, unplaced } = placeThreads(file, file.hunks, [t], 'unified');
		expect([...marks.keys()]).toEqual([`${id}:2`, `${id}:3`, `${id}:4`]);
		expect(marks.get(`${id}:2`)).toMatchObject({ first: true, last: false, threads: [] });
		expect(marks.get(`${id}:4`)).toMatchObject({ first: false, last: true, threads: [t] });
		expect(unplaced).toEqual([]);
	});

	test('in split, keys carry the side, an old-side thread sits on the removed line', () => {
		const t = thread({ side: 'old', line: 2 });
		const { marks } = placeThreads(file, file.hunks, [t], 'split');
		expect([...marks.keys()]).toEqual([`${id}:1:old`]);
	});

	test('two threads ending on one line share it, a line knows every thread on it', () => {
		const a = thread({ id: 'A' });
		const b = thread({ id: 'B', line: 4, startLine: 2 });
		const { marks } = placeThreads(file, file.hunks, [a, b], 'unified');
		expect(marks.get(`${id}:2`)).toMatchObject({ ids: ['A', 'B'], threads: [a] });
		expect(marks.get(`${id}:4`)).toMatchObject({ ids: ['B'], threads: [b] });
	});

	test('outdated, whole-file and off-diff threads are unplaced, other files skipped', () => {
		const threads = [
			thread({ id: 'old', isOutdated: true }),
			thread({ id: 'file', file: true, line: null }),
			thread({ id: 'off', line: 40 }),
			thread({ id: 'other', path: 'g.ts' })
		];
		const { marks, unplaced } = placeThreads(file, file.hunks, threads, 'unified');
		expect(marks.size).toBe(0);
		expect(unplaced.map((t) => t.id)).toEqual(['old', 'file', 'off']);
	});

	test('a thread in a hunk not on screen is neither marked nor unplaced', () => {
		const { marks, unplaced } = placeThreads(file, [], [thread({})], 'unified');
		expect(marks.size).toBe(0);
		expect(unplaced).toEqual([]);
	});
});
