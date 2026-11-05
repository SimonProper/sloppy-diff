<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import DiffRows from '$lib/components/DiffRows.svelte';
	import { inSpan } from '$lib/ask/span';
	import { linesOf, type Thread } from '$lib/ask/types';
	import type { DiffFile, DiffLine } from '$lib/diff/types';
	import { displayPath } from '$lib/diff/path';
	import { findHunk } from '$lib/diff/hunks';

	interface Props {
		thread: Thread;
		files: DiffFile[];
		/** the guide section the lines are in, "§2" */
		section?: string;
		/** just the asked lines, for a narrow docked panel */
		compact?: boolean;
		onclose: () => void;
		onreveal: () => void;
	}

	let { thread, files, section, compact = false, onclose, onreveal }: Props = $props();

	const anchor = $derived(thread.anchor);
	const lines = $derived(linesOf(anchor));
	const found = $derived(lines && findHunk(files, lines.hunk));
	const name = $derived(anchor.path.split('/').pop() ?? anchor.path);

	let whole = $state(false);
	/** the lines shown: the hunk, or in a compact excerpt the asked ones (six at most) */
	const shown = $derived.by(() => {
		if (!found || !lines) return [];
		const all = found.hunk.lines.map((line, index) => ({ line, index }));
		if (!compact || whole) return all;
		return all.slice(lines.start, Math.min(lines.end + 1, lines.start + 6));
	});

	const asked = (index: number, line: DiffLine) => !!lines && inSpan(lines, index, line);
	// a question about one side of a split diff: the other side's lines stay, dimmed
	const dimmed = (line: DiffLine) =>
		(anchor.side === 'old' && line.kind === 'add') ||
		(anchor.side === 'new' && line.kind === 'del');

	let body = $state<HTMLElement>();
	// the asked lines in the middle of the pane whenever another question opens
	$effect(() => {
		void thread.id;
		const first = body?.querySelector<HTMLElement>('[data-asked]');
		if (first && body) body.scrollTop = first.offsetTop - body.clientHeight / 2 + 40;
	});
</script>

<section class="flex min-h-0 min-w-0 flex-col">
	<header
		class="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-3 text-[12px] shadow-strip"
	>
		<Button variant="ghost" onclick={onclose}>
			<svg
				viewBox="0 0 16 16"
				class="size-3.5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="M13 8H3.5M7.5 4 3.5 8l4 4" /></svg
			>
			Diff <kbd class="font-mono text-[10.5px] text-faint">esc</kbd>
		</Button>
		{#if anchor.path}
			<span class="min-w-0 truncate font-mono text-[12px]" title={anchor.path}>
				<span class="text-muted">{anchor.path.slice(0, -name.length)}</span>{name}
				<span class="text-faint">· {anchor.label}</span>
			</span>
		{:else}
			<span class="min-w-0 truncate">Whole change</span>
		{/if}
		{#if section}
			<span class="shrink-0 rounded-md bg-subtle px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
				>{section}</span
			>
		{/if}
		<span class="flex-1"></span>
		{#if !thread.outdated && anchor.path}
			<Button variant="ghost" onclick={onreveal}>Show in diff ↗</Button>
		{/if}
	</header>

	<div bind:this={body} class="relative min-h-0 flex-1 overflow-y-auto p-4">
		{#if !lines}
			<p class="text-[12px] leading-snug text-muted">
				{#if anchor.path}
					A question about the whole of <span class="font-mono text-fg">{anchor.path}</span>.
				{:else}
					A question about the whole change.
				{/if}
			</p>
		{:else if thread.outdated || !found}
			<p
				class="mb-3 flex items-start gap-2 rounded-[calc(var(--radius)*1.25)] bg-mod/10 px-3 py-2.5 text-[12px] leading-snug text-mod"
			>
				These lines have changed since you asked. Showing them as they were.
			</p>
			<pre
				class="overflow-x-auto rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-[12.5px] leading-5 whitespace-pre-wrap">{anchor.code}</pre>
		{:else}
			<div class="overflow-clip rounded-xl border border-line bg-surface">
				<div
					class="flex h-9 items-center gap-2 border-b border-line px-3 font-mono text-[12px] text-muted"
				>
					{displayPath(found.file)}
				</div>
				<div
					class="flex h-7 items-center bg-subtle pl-[7.25rem] font-mono text-[11.5px] whitespace-pre text-accent/80"
				>
					@@ -{found.hunk.oldStart},{found.hunk.oldLines} +{found.hunk.newStart},{found.hunk
						.newLines} @@
					{#if found.hunk.section}<span class="truncate pl-3 text-muted"
							>{found.hunk.section.trim()}</span
						>{/if}
				</div>
				<DiffRows rows={shown} {asked} {dimmed} first={anchor.start} />
				{#if compact && found.hunk.lines.length > shown.length && !whole}
					<button
						type="button"
						class="w-full border-t border-line py-1.5 text-[11.5px] text-muted hover:text-fg"
						onclick={() => (whole = true)}>Whole hunk ▾</button
					>
				{/if}
			</div>
		{/if}
	</div>
</section>
