import { expect, test } from 'vitest';
import { groupThreads } from './groups';
import type { Thread } from './types';

const thread = (id: string, at: string[], outdated = false) =>
	({
		id,
		createdAt: at[0],
		outdated,
		messages: at.map((createdAt) => ({ role: 'user', text: '', createdAt }))
	}) as unknown as Thread;

test('the chat asked or answered in last comes first, those about changed code last', () => {
	const list = [
		thread('old', ['2026-01-01']),
		thread('answered', ['2026-01-02', '2026-01-05']),
		thread('changed', ['2026-01-09'], true),
		thread('asked', ['2026-01-04'])
	];
	expect(groupThreads(list).map((g) => [g.key, g.threads.map((t) => t.id)])).toEqual([
		['current', ['answered', 'asked', 'old']],
		['outdated', ['changed']]
	]);
});
