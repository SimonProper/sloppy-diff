<script lang="ts">
	import { inSpan } from '$lib/ask/span';
	import type { Thread } from '$lib/ask/types';
	import type { DiffFile, DiffLine } from '$lib/diff/types';
	import { displayPath } from '$lib/diff/path';

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
	const found = $derived.by(() => {
		for (const file of files) {
			const hunk = file.hunks.find((h) => h.id === anchor.hunk);
			if (hunk) return { file, hunk };
		}
		return null;
	});
	const name = $derived(anchor.path.split('/').pop() ?? anchor.path);

	let whole = $state(false);
	/** the lines shown: the hunk, or in a compact excerpt the asked ones (six at most) */
	const shown = $derived.by(() => {
		if (!found) return [];
		const all = found.hunk.lines.map((line, index) => ({ line, index }));
		if (!compact || whole) return all;
		return all.slice(anchor.start, Math.min(anchor.end + 1, anchor.start + 6));
	});

	const asked = (index: number, line: DiffLine) => inSpan(anchor, index, line);
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
	<header class="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-3 text-[12px]">
		<button
			type="button"
			class="flex h-7 items-center gap-1.5 rounded-md px-2 text-muted hover:bg-subtle hover:text-fg"
			onclick={onclose}
		>
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
		</button>
		<span class="min-w-0 truncate font-mono text-[12px]" title={anchor.path}>
			<span class="text-muted">{anchor.path.slice(0, -name.length)}</span>{name}
			<span class="text-faint">· {anchor.label}</span>
		</span>
		{#if section}
			<span class="shrink-0 rounded-md bg-subtle px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
				>{section}</span
			>
		{/if}
		<span class="flex-1"></span>
		{#if !thread.outdated}
			<button
				type="button"
				class="h-7 shrink-0 rounded-md px-2 text-muted hover:bg-subtle hover:text-fg"
				onclick={onreveal}>Show in diff ↗</button
			>
		{/if}
	</header>

	<div bind:this={body} class="relative min-h-0 flex-1 overflow-y-auto p-4">
		{#if thread.outdated || !found}
			<p
				class="mb-3 flex items-start gap-2 rounded-[10px] bg-mod/10 px-3 py-2.5 text-[12px] leading-snug text-mod"
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
				<div class="twinkleplop font-mono text-[12.5px] leading-5">
					{#each shown as { line, index } (index)}
						{@const on = asked(index, line)}
						<div
							class={['row flex', line.kind, on && 'asked', dimmed(line) && 'dim']}
							data-asked={on && index === anchor.start ? '' : undefined}
						>
							<span
								class="gutter flex w-24 shrink-0 text-right text-[11px] text-faint tabular-nums select-none"
							>
								<span class="w-12 pr-2">{line.old ?? ''}</span>
								<span class="w-12 pr-2">{line.new ?? ''}</span>
							</span>
							<span class="marker w-5 shrink-0 text-center select-none"
								>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span
							>
							<span class="min-w-0 flex-1 pr-4 break-all whitespace-pre-wrap"
								>{@html line.html}</span
							>
							<span class={['mark w-3.5 shrink-0 self-stretch', on && 'on']}></span>
						</div>
					{/each}
				</div>
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

<style>
	.gutter {
		background: var(--surface);
		border-right: 1px solid var(--line);
	}
	.row.add {
		background: var(--add-bg);
	}
	.row.add .gutter {
		background: var(--add-gutter);
		color: var(--add);
	}
	.row.add .marker {
		color: var(--add);
	}
	.row.del {
		background: var(--del-bg);
	}
	.row.del .gutter {
		background: var(--del-gutter);
		color: var(--del);
	}
	.row.del .marker {
		color: var(--del);
	}
	.row.add :global(.novel) {
		background: var(--add-novel);
		border-radius: 3px;
	}
	.row.del :global(.novel) {
		background: var(--del-novel);
		border-radius: 3px;
	}
	.row.asked {
		box-shadow: inset 0 0 0 100vmax var(--ink-wash);
	}
	.row.asked .gutter {
		background: color-mix(in oklab, var(--fg) 10%, var(--surface));
		color: var(--fg);
	}
	.row.dim {
		opacity: 0.38;
	}
	.mark {
		position: relative;
	}
	.mark.on::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		right: 6px;
		width: 2px;
		background: var(--ink-mark);
	}
</style>
