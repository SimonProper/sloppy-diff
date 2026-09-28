<script lang="ts">
	import type { DiffFile, DiffLine } from '$lib/diff/types';
	import type { GuideNote } from '$lib/guide/types';
	import { splitRows, type Layout } from '$lib/diff/split';
	import { displayPath, isGenerated, splitPath } from '$lib/diff/path';
	import { chunk } from '$lib/lazy';
	import StatusBadge from './StatusBadge.svelte';
	import ChangeBar from './ChangeBar.svelte';
	import LazyBlock from './LazyBlock.svelte';

	interface Props {
		file: DiffFile;
		/** only show these hunks, used by guide sections */
		only?: string[];
		notes?: GuideNote[];
		/** element id, defaults to the file id */
		anchor?: string;
		/** link to the file in the full diff */
		href?: string;
		/** stick the header below the page header and changes bar */
		sticky?: boolean;
		/** also below a guide step's sticky title */
		inSection?: boolean;
		/** start open even when the file would normally start collapsed */
		expanded?: boolean;
		/** one column of rows, or old and new side by side */
		layout?: Layout;
		/** only render lines near the viewport, for diffs too big to render whole */
		virtualize?: boolean;
	}

	let {
		file,
		only,
		notes = [],
		anchor,
		href,
		sticky = true,
		inSection = false,
		expanded = false,
		layout = 'unified',
		virtualize = false
	}: Props = $props();

	// lockfiles and formatting-only files start collapsed. Derived, so a file reused for
	// another commit or change mode starts from its own default, and still toggles
	let open = $derived(expanded || (!isGenerated(file) && !file.changes?.formattingOnly));

	const MOVED = 'Moved or reformatted, nothing in this line is new';
	/** lines rendered together, each block only once it's near the viewport */
	const BLOCK = 100;
	/** height of a row, leading-5; split rows can wrap so theirs is a guess until rendered */
	const ROW = 20;

	/**
	 * The longest line of each hunk in columns, tabs at their default width of 8.
	 * Sets the hunk's scroll width, which otherwise only counts the blocks that
	 * happen to be rendered and jumps as others come and go.
	 */
	const widths = $derived(
		new Map(
			file.hunks.map((h) => [
				h.id,
				Math.max(0, ...h.lines.map((l) => l.text.replace(/\t/g, '        ').length))
			])
		)
	);

	const path = $derived(splitPath(displayPath(file)));
	const hunks = $derived(only ? file.hunks.filter((h) => only.includes(h.id)) : file.hunks);
	const counts = $derived(
		only
			? hunks.reduce(
					(sum, h) => {
						for (const l of h.lines) {
							if (l.kind === 'add') sum.additions++;
							else if (l.kind === 'del') sum.deletions++;
						}
						return sum;
					},
					{ additions: 0, deletions: 0 }
				)
			: { additions: file.additions, deletions: file.deletions }
	);
</script>

<section
	id={anchor ?? file.id}
	class={[
		'overflow-clip rounded-xl border border-line bg-surface',
		inSection ? 'scroll-mt-38' : 'scroll-mt-28'
	]}
>
	<header
		class={[
			'flex h-10 items-center gap-2.5 bg-surface px-3 text-[13px]',
			// below the header and the sticky changes bar, and a guide step's title (44px)
			sticky && 'sticky z-10',
			sticky && (inSection ? 'top-34' : 'top-23'),
			open && 'border-b border-line'
		]}
	>
		<button
			type="button"
			class="-ml-1 grid size-6 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg"
			aria-expanded={open}
			aria-label={open ? 'Collapse file' : 'Expand file'}
			onclick={() => (open = !open)}
		>
			<svg
				viewBox="0 0 16 16"
				class={['size-3.5 transition-transform', !open && '-rotate-90']}
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="m4 6 4 4 4-4" /></svg
			>
		</button>
		<StatusBadge status={file.status} />
		<span class="min-w-0 truncate font-mono text-[12.5px]">
			{#if file.status === 'renamed' || file.status === 'copied'}
				<span class="text-muted">{file.oldPath}</span>
				<span class="px-1 text-faint">→</span>
			{/if}
			<span class="text-muted">{path.dir}</span><span class="font-medium">{path.name}</span>
		</span>
		{#if file.changes?.formattingOnly}
			<span
				class="shrink-0 rounded-md bg-mod/10 px-1.5 py-0.5 text-[10.5px] font-medium text-mod"
				title="Only reformatted: the same code with different whitespace or line breaks"
				>formatting only</span
			>
		{:else if file.changes?.movedOnly}
			<span
				class="shrink-0 rounded-md bg-move/10 px-1.5 py-0.5 text-[10.5px] font-medium text-move"
				title="Every changed line moved here from elsewhere, or from here to elsewhere"
				>moved only</span
			>
		{/if}
		{#if only && hunks.length < file.hunks.length}
			<span class="shrink-0 text-[11px] text-faint">
				{hunks.length} of {file.hunks.length} hunks
			</span>
		{/if}
		<span class="ml-auto flex shrink-0 items-center gap-3">
			{#if file.language}
				<span class="text-[11px] text-faint">{file.language}</span>
			{/if}
			<span class="font-mono text-[11px] tabular-nums">
				<span class="text-add">+{counts.additions}</span>
				<span class="text-del">−{counts.deletions}</span>
			</span>
			<ChangeBar additions={counts.additions} deletions={counts.deletions} />
			{#if href}
				<a
					{href}
					class="rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-subtle hover:text-fg"
					>View file</a
				>
			{/if}
		</span>
	</header>

	{#if open}
		{#if file.binary}
			<p class="px-4 py-6 text-center text-xs text-muted">Binary file not shown</p>
		{:else if hunks.length === 0}
			<p class="px-4 py-6 text-center text-xs text-muted">No content changes</p>
		{:else}
			{#each hunks as hunk, h (hunk.id)}
				{#each notes.filter((n) => n.hunk === hunk.id) as note, n (n)}
					<div
						class={[
							'flex gap-2.5 border-l-2 border-accent bg-accent/6 px-4 py-2.5 text-[12.5px] leading-relaxed',
							h > 0 && 'border-t border-t-line'
						]}
					>
						<svg
							viewBox="0 0 16 16"
							class="mt-0.5 size-3.5 shrink-0 text-accent"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.5M8 5v.01" /></svg
						>
						<p class="whitespace-pre-wrap">{note.text}</p>
					</div>
				{/each}
				<div
					class={[
						'flex h-7 items-center bg-subtle font-mono text-[11.5px] text-muted',
						h > 0 && 'border-t border-line'
					]}
				>
					<span
						class={[
							'whitespace-pre text-accent/80',
							layout === 'split' ? 'pl-[4.25rem]' : 'pl-[7.25rem]'
						]}>@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span
					>
					{#if hunk.section}
						<span class="truncate pr-6 pl-3 whitespace-pre">{hunk.section.trim()}</span>
					{/if}
				</div>
				{#if layout === 'split'}
					<!-- long lines wrap so both sides of a row stay aligned -->
					<div class="twinkleplop font-mono text-[12.5px] leading-5">
						{#each chunk(splitRows(hunk), BLOCK) as rows, b (b)}
							<LazyBlock estimate={rows.length * ROW} lazy={virtualize}>
								{#each rows as row, i (i)}
									<div class="grid grid-cols-2">
										{@render cell(row.left, 'old')}
										{@render cell(row.right, 'new')}
									</div>
								{/each}
							</LazyBlock>
						{/each}
					</div>
				{:else}
					<div class="twinkleplop overflow-x-auto font-mono text-[12.5px] leading-5">
						<!-- gutter (6rem), marker (1.25rem) and right padding (2rem) around the code -->
						<div
							class="w-max min-w-full"
							style:min-width="max(100%, calc({widths.get(hunk.id)}ch + 9.25rem))"
						>
							{#each chunk(hunk.lines, BLOCK) as lines, b (b)}
								<LazyBlock estimate={lines.length * ROW} lazy={virtualize}>
									{#each lines as line, i (i)}
										<div
											class={['row flex', line.kind, line.moved && 'moved']}
											title={line.moved ? MOVED : undefined}
										>
											<span
												class="gutter sticky left-0 flex w-24 shrink-0 text-right text-[11px] text-faint tabular-nums select-none"
											>
												<span class="w-12 pr-2">{line.old ?? ''}</span>
												<span class="w-12 pr-2">{line.new ?? ''}</span>
											</span>
											{@render marker(line)}
											<span class="text pr-8 whitespace-pre">{@render code(line)}</span>
										</div>
									{/each}
								</LazyBlock>
							{/each}
						</div>
					</div>
				{/if}
			{/each}
		{/if}
	{/if}
</section>

{#snippet marker(line: DiffLine)}
	<span class="marker w-5 shrink-0 text-center select-none"
		>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span
	>
{/snippet}

{#snippet code(line: DiffLine)}
	{@html line.html}{#if line.noNewline}<span
			class="ml-2 font-sans text-[10px] text-faint select-none"
			title="No newline at end of file">no newline</span
		>{/if}{#if line.moveLabel}<span
			class="ml-3 rounded-[4px] bg-move/10 px-1 font-sans text-[10px] text-move select-none"
			>{line.moveLabel}</span
		>{/if}
{/snippet}

{#snippet cell(line: DiffLine | null, side: 'old' | 'new')}
	{#if line}
		<div
			class={['row flex min-w-0', line.kind, line.moved && 'moved', side === 'old' && 'split-old']}
			title={line.moved ? MOVED : undefined}
		>
			<span
				class="gutter w-12 shrink-0 pr-2 text-right text-[11px] text-faint tabular-nums select-none"
				>{side === 'old' ? line.old : line.new}</span
			>
			{@render marker(line)}
			<span class="text min-w-0 flex-1 pr-4 break-all whitespace-pre-wrap"
				>{@render code(line)}</span
			>
		</div>
	{:else}
		<!-- no counterpart on this side -->
		<div class={['filler', side === 'old' && 'split-old']}></div>
	{/if}
{/snippet}

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

	/* the pieces of a line that are actually new */
	.row.add :global(.novel) {
		background: var(--add-novel);
		border-radius: 3px;
	}
	.row.del :global(.novel) {
		background: var(--del-novel);
		border-radius: 3px;
	}

	/* changed according to git, but nothing new: moved, re-indented or re-wrapped */
	.row.moved.add,
	.row.moved.del {
		background: var(--surface);
	}
	.row.moved .text,
	.row.moved .marker {
		opacity: 0.5;
	}

	/* split layout */
	.split-old {
		border-right: 1px solid var(--line);
	}
	.filler {
		/* a 10px tile that repeats seamlessly, rows are multiples of 20px high so the
		   stripes of stacked empty cells join up instead of restarting at each row */
		background-image: linear-gradient(
			-45deg,
			var(--subtle) 25%,
			var(--surface) 25% 50%,
			var(--subtle) 50% 75%,
			var(--surface) 75%
		);
		background-size: 10px 10px;
	}
</style>
