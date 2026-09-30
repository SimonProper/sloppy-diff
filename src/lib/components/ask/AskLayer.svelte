<script lang="ts">
	import { untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { moveCursor, selectedSpan, span, startCursor, switchSide } from '$lib/ask/rows';
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { DiffFile } from '$lib/diff/types';
	import type { Guide } from '$lib/guide/types';
	import { typing } from '$lib/keys';
	import AskComposer from './AskComposer.svelte';
	import AskLens from './AskLens.svelte';
	import AskPeek from './AskPeek.svelte';

	interface Props {
		threads: Threads;
		files: DiffFile[];
		/** the guide being read, when the guide view is open */
		guide?: Guide | null;
	}

	let { threads, files, guide }: Props = $props();

	/** The guide section a hunk is read in, sent along as context for the question. */
	const sectionOf = (hunk: string) => guide?.sections.find((s) => s.hunks.includes(hunk))?.id;

	// a, q, and picking lines from the keyboard, also while the panel is docked. The
	// panel and the lens handle their own keys
	function onkeydown(event: KeyboardEvent) {
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
		if (typing(event)) return;

		const cursor = threads.cursor;
		if (cursor) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				threads.cursor = moveCursor(cursor, event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
			} else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				threads.cursor = switchSide(cursor);
			} else if (event.key === 'Enter') {
				threads.select(
					span(cursor.hunk, cursor.anchor, cursor.head, cursor.side),
					sectionOf(cursor.hunk)
				);
			} else if (event.key === 'Escape') {
				threads.cursor = null;
			} else return;
			event.preventDefault();
			return;
		}

		if (event.key === 'a') {
			const selected = selectedSpan(document.querySelector('main') ?? undefined);
			if (selected) {
				threads.select(selected.span, sectionOf(selected.span.hunk));
				window.getSelection()?.removeAllRanges();
			} else {
				threads.cursor = startCursor();
			}
		} else if (event.key === 'q' && threads.open) {
			threads.close();
		} else if (event.key === 'q' && threads.list.length) {
			threads.openLens();
		} else if (event.key === 'Escape' && threads.composing) {
			threads.composing = false;
		} else if (event.key === 'Escape' && threads.draft) {
			threads.draft = null;
		} else if (event.key === 'Escape' && threads.open) {
			threads.close();
		} else return;
		event.preventDefault();
	}

	// ?ask=<id> while the lens is open, so a reload or a link opens it again
	let restored = false;
	$effect(() => {
		const open = threads.open;
		untrack(() => {
			if (!restored) {
				restored = true;
				const asked = page.url.searchParams.get('ask');
				if (asked && threads.get(asked)) threads.openLens(asked);
				// the first run can be the page's first mount, before the router has started,
				// where replaceState throws and leaves SvelteKit to mount every later page
				// beside this one. A stale ?ask= stays until the lens next opens or closes
				return;
			}
			if ((page.url.searchParams.get('ask') ?? null) === open) return;
			const url = new URL(page.url);
			if (open) url.searchParams.set('ask', open);
			else url.searchParams.delete('ask');
			replaceState(url, page.state);
		});
	});

	// a question that's gone, deleted or from another diff, closes the lens
	$effect(() => {
		if (threads.open && !threads.get(threads.open)) threads.close();
	});
</script>

<svelte:window {onkeydown} />

{#if threads.cursor}
	<!-- picking lines from the keyboard, what the keys do meanwhile -->
	<div
		class="pointer-events-none fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2 text-[12px] whitespace-nowrap text-muted shadow-float"
		role="status"
	>
		<span><kbd>↑</kbd><kbd>↓</kbd> line</span>
		<span><kbd>⇧</kbd><kbd>↑</kbd><kbd>↓</kbd> more lines</span>
		{#if threads.cursor.side}<span><kbd>←</kbd><kbd>→</kbd> other side</span>{/if}
		<span><kbd>↵</kbd> ask</span>
		<span><kbd>esc</kbd> cancel</span>
	</div>
{/if}

<AskComposer {threads} {files} {guide} />
<AskPeek {threads} />
<!-- the lens over the whole page. Docked, the page places it in its layout -->
<AskLens {threads} {files} {guide} />

<style>
	kbd {
		margin-right: 2px;
		font: 10.5px var(--font-mono);
		color: var(--fg);
	}
</style>
