import { flushSync } from 'svelte';
import { describe, expect, test, vi } from 'vitest';

vi.mock('./ask.remote', () => ({}));
vi.mock('$lib/pr/pr.remote', () => ({}));
vi.mock('$lib/pr/refresh', () => ({}));

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => stored.get(key) ?? null,
	setItem: (key: string, value: string) => stored.set(key, value),
	removeItem: (key: string) => stored.delete(key)
});

const { Threads } = await import('./threads.svelte');

describe('what is typed and not sent', () => {
	test('comes back on the next page load of the same diff, the composer open', () => {
		const config = () => ({ repo: 'r', from: '', to: '', scope: 'worktree' as const, threads: [] });
		const span = { hunk: 'h', start: 0, end: 1 };

		const cleanup = $effect.root(() => {
			const first = new Threads(config);
			flushSync();
			first.select(span);
			first.draft!.text = 'why this?';
			first.replies = { t1: 'and then?', t2: '  ' };
			flushSync();
		});
		cleanup();

		$effect.root(() => {
			const again = new Threads(config);
			flushSync();
			expect(again.draft).toEqual({ span, text: 'why this?' });
			expect(again.composing).toBe(true);
			expect(again.replies).toEqual({ t1: 'and then?' });

			// sent: nothing left to keep
			again.draft = null;
			again.replies = {};
			flushSync();
			expect(stored.size).toBe(0);
		})();
	});
});
