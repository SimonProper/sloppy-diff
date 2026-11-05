<script lang="ts">
	import DiffRows from '$lib/components/DiffRows.svelte';
	import { findHunk, spanAt } from '$lib/diff/hunks';
	import { parseDiff } from '$lib/diff/parse';
	import type { DiffFile, DiffLine } from '$lib/diff/types';
	import type { ReviewThread } from '$lib/pr/types';

	interface Props {
		thread: ReviewThread;
		/** the diff, to draw lines still in it as it does */
		files?: DiffFile[];
		/** how many lines, up to the last commented one */
		lines?: number;
	}

	let { thread, files = [], lines = 6 }: Props = $props();

	/** the end of the code a thread was started on: from the diff while it's there, else
	 * GitHub's hunk as it was, unhighlighted */
	const rows = $derived.by((): { line: DiffLine; index: number }[] => {
		if (thread.file) return [];
		const span =
			thread.line !== null &&
			spanAt(files, thread.path, thread.side, thread.line, thread.startLine ?? thread.line);
		const hunk = span ? findHunk(files, span.hunk)?.hunk : undefined;
		if (span && hunk) {
			const from = Math.max(0, span.end - lines + 1);
			return hunk.lines.slice(from, span.end + 1).map((line, i) => ({ line, index: from + i }));
		}
		const path = thread.path;
		const old = parseDiff(
			`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${thread.diffHunk}`
		)[0]?.hunks[0]?.lines;
		return (old ?? []).slice(-lines).map((line, i) => ({ line, index: i }));
	});
</script>

{#if rows.length}
	<div class="border-b border-line">
		<DiffRows {rows} />
	</div>
{/if}
