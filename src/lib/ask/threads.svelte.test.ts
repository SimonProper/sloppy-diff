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
const { parseDiff } = await import('$lib/diff/parse');

const files = parseDiff(
	[
		'diff --git a/a.ts b/a.ts',
		'--- a/a.ts',
		'+++ b/a.ts',
		'@@ -1,1 +1,2 @@',
		' one',
		'+two',
		''
	].join('\n')
);
const hunk = files[0].hunks[0].id;

describe('what is typed and not sent', () => {
	test('comes back on the next page load of the same diff, the composer open', () => {
		const config = () => ({
			repo: 'r',
			from: '',
			to: '',
			scope: 'worktree' as const,
			threads: [],
			files
		});
		const span = { hunk, start: 0, end: 1 };

		const cleanup = $effect.root(() => {
			const first = new Threads(config);
			flushSync();
			first.draft = { span, text: 'nit: rename' };
			first.composing = true;
			first.replies = { t1: 'and then?', t2: '  ' };
			// picked lines go to the panel's new chat, labelled
			first.select(span);
			first.newChat = 'why this?';
			flushSync();
			expect(first.panel).toBe(true);
			expect(first.attached['']).toEqual([
				{ ...span, path: 'a.ts', label: 'lines 1–2', code: '', section: undefined }
			]);
			first.draft = { span, text: 'nit: rename' };
			first.composing = true;
			flushSync();
		});
		cleanup();

		$effect.root(() => {
			const again = new Threads(config);
			flushSync();
			expect(again.draft).toEqual({ span, text: 'nit: rename' });
			expect(again.composing).toBe(true);
			expect(again.replies).toEqual({ t1: 'and then?' });
			expect(again.newChat).toBe('why this?');
			expect(again.attached[''][0].label).toBe('lines 1–2');

			// sent: nothing left to keep
			again.draft = null;
			again.replies = {};
			again.newChat = '';
			again.attached = {};
			flushSync();
			expect(stored.size).toBe(0);
		})();
	});
});

describe('lines picked in the diff', () => {
	test('go to the open chat, or with fresh to a new one, what was typed to its field', () => {
		const chat = {
			id: 't1',
			anchor: { path: '', label: 'whole change', code: '' },
			messages: [],
			createdAt: ''
		};
		const config = () => ({
			repo: 'r',
			from: '',
			to: '',
			scope: 'worktree' as const,
			threads: [chat],
			files
		});
		const span = { hunk, start: 1, end: 1 };

		$effect.root(() => {
			const threads = new Threads(config);
			flushSync();
			threads.openLens('t1');
			threads.add({ span, text: 'why?' });
			threads.add({ span, text: 'and this' });
			expect(threads.attached.t1).toMatchObject([{ label: 'line 2' }]);
			expect(threads.replies.t1).toBe('why?\nand this');
			expect(threads.adding).toBe(threads.attached.t1);

			threads.select(span, undefined, true);
			expect(threads.open).toBe(null);
			expect(threads.attached['']).toMatchObject([{ label: 'line 2' }]);
			expect(threads.attached.t1).toHaveLength(1);
			threads.attached = {};
			flushSync();
		})();
	});
});

describe('comments on a pull request', () => {
	test('each stays at its own lines when others are picked, and comes back after a reload', () => {
		stored.clear();
		const config = () => ({
			repo: 'r',
			from: 'a',
			to: 'b',
			scope: 'worktree' as const,
			threads: [],
			files,
			pr: 1,
			prId: 'P'
		});
		const first = { hunk, start: 0, end: 0 };
		const second = { hunk, start: 1, end: 1 };

		const cleanup = $effect.root(() => {
			const threads = new Threads(config);
			flushSync();
			threads.setIntent('comment');
			threads.select(first);
			threads.draft!.text = 'about one';
			threads.select(second);
			expect(threads.draft).toEqual({ span: second, text: '' });
			expect(threads.drafts).toEqual([{ span: first, text: 'about one' }]);

			// opened again from its mark, the one open goes to its lines, empty ones aren't kept
			threads.reopen(threads.drafts[0]);
			expect(threads.draft).toEqual({ span: first, text: 'about one' });
			expect(threads.drafts).toEqual([]);
			threads.draft!.text = 'about one, more';
			threads.putAway();
			flushSync();
		});
		cleanup();

		const again = $effect.root(() => {
			const threads = new Threads(config);
			flushSync();
			expect(threads.drafts).toEqual([{ span: first, text: 'about one, more' }]);
		});
		again();
	});
});
