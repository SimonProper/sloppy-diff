<script lang="ts">
	import { untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { moveCursor, selectedSpan, span, startCursor, switchSide } from '$lib/ask/rows';
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { DiffFile } from '$lib/diff/types';
	import type { Guide } from '$lib/guide/types';
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

	// a, q, and picking lines from the keyboard. The lens handles its own keys
	function onkeydown(event: KeyboardEvent) {
		if (threads.open || event.metaKey || event.ctrlKey || event.altKey) return;
		if ((event.target as HTMLElement).closest('input, textarea, [contenteditable], dialog')) return;

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
		} else if (event.key === 'q' && threads.list.length) {
			threads.openLens();
		} else if (event.key === 'Escape' && threads.composing) {
			threads.composing = false;
		} else if (event.key === 'Escape' && threads.draft) {
			threads.draft = null;
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
				if (asked && threads.get(asked)) {
					threads.openLens(asked);
					return;
				}
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

<AskComposer {threads} {files} {guide} />
<AskPeek {threads} />
<AskLens {threads} {files} {guide} />
