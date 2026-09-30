import { expect, test } from 'vitest';
import type { DiffFile } from '$lib/diff/types';
import type { Guide } from '$lib/guide/types';
import { groupThreads } from './groups';
import type { Anchor, Thread } from './types';

const files = [
	{ id: 'a', newPath: 'a.ts', hunks: [{ id: 'a1' }, { id: 'a2' }] },
	{ id: 'b', newPath: 'b.ts', hunks: [{ id: 'b1' }] }
] as DiffFile[];
const thread = (id: string, anchor: Partial<Anchor>) =>
	({ id, anchor: { label: '', code: '', ...anchor }, messages: [] }) as unknown as Thread;
const list = [
	thread('line-a2', { path: 'a.ts', hunk: 'a2', start: 0, end: 0 }),
	thread('file-a', { path: 'a.ts' }),
	thread('line-b1', { path: 'b.ts', hunk: 'b1', start: 0, end: 0 }),
	thread('change', { path: '' })
];
const ids = (groups: ReturnType<typeof groupThreads>) =>
	groups.map((g) => [g.key, g.threads.map((t) => t.id)]);

test('the whole change comes first, and a whole file before its lines', () => {
	expect(ids(groupThreads(list, files))).toEqual([
		['change', ['change']],
		['a', ['file-a', 'line-a2']],
		['b', ['line-b1']]
	]);
});

test('in a guide, a whole file sits in the first section that reads it', () => {
	const guide = {
		sections: [
			{ id: 's1', title: 'One', kind: 'core', hunks: ['b1', 'a2'] },
			{ id: 's2', title: 'Two', kind: 'core', hunks: ['a1'] }
		]
	} as unknown as Guide;
	expect(ids(groupThreads(list, files, guide))).toEqual([
		['change', ['change']],
		['s1', ['file-a', 'line-b1', 'line-a2']]
	]);
});
