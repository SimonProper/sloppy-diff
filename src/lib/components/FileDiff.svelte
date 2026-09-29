<script lang="ts">
	import type { DiffFile, DiffLine, Hunk } from '$lib/diff/types';
	import type { GuideNote } from '$lib/guide/types';
	import { selectedSpan, span } from '$lib/ask/rows';
	import { inSpan } from '$lib/ask/span';
	import type { Status, Threads } from '$lib/ask/threads.svelte';
	import type { LineSpan, Side, Thread } from '$lib/ask/types';
	import { splitRows, type Layout } from '$lib/diff/split';
	import { displayPath, isGenerated, splitPath } from '$lib/diff/path';
	import { storedOpen, storeOpen } from '$lib/diff/folds';
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
		/** questions to Claude about lines of the diff, none when absent */
		threads?: Threads;
		/** the guide section the file is read in, context for the questions */
		section?: string;
		/** where opening and closing the file is remembered, by path, not remembered when absent */
		remember?: string;
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
		virtualize = false,
		threads,
		section,
		remember
	}: Props = $props();

	// lockfiles and formatting-only files start collapsed, unless the reader opened them
	// before. Derived, so a file reused for another commit or change mode starts from its
	// own default or what was stored, and still toggles
	const startsOpen = $derived(expanded || (!isGenerated(file) && !file.changes?.formattingOnly));
	let open = $derived(
		(remember ? storedOpen(remember, displayPath(file)) : undefined) ?? startsOpen
	);

	function toggle() {
		open = !open;
		if (remember) storeOpen(remember, displayPath(file), open, startsOpen);
	}

	const REFORMATTED = 'Reformatted, nothing in this line is new';
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

	// asking Claude: lines are picked by dragging over their numbers, or by selecting
	// text and taking up the offer that shows up under it. Rows carry their hunk and
	// index so a pointer, a selection or the keyboard cursor can be traced to lines.
	// The conversations themselves live in the lens, a question only leaves a marker
	// down the right edge of its lines

	let root: HTMLElement;

	/** where each line sits in its hunk */
	const lineIndex = $derived(
		new Map(file.hunks.flatMap((h) => h.lines.map((l, i) => [l, i] as const)))
	);
	const fileThreads = $derived(threads ? threads.in(hunks.map((h) => h.id)) : []);

	/** the lines being dragged over, from `anchor` to wherever the pointer is */
	let drag = $state<{ hunk: string; side?: Side; anchor: number } | null>(null);
	let dragged = $state<LineSpan | null>(null);
	const cursor = $derived(threads?.cursor ?? null);
	const picked = $derived(
		dragged ??
			(cursor && span(cursor.hunk, cursor.anchor, cursor.head, cursor.side)) ??
			threads?.draft?.span ??
			null
	);

	/** changed with no tokens marked as new: in lines mode, or new or removed as a whole */
	function tinted(line: DiffLine) {
		return line.kind !== 'ctx' && !line.spans?.length && !line.reformatted;
	}

	function isPicked(hunk: string, index: number, line: DiffLine, side?: Side) {
		return picked?.hunk === hunk && inSpan(picked, index, line, side);
	}

	/** One line's piece of a question's marker. */
	interface Mark {
		status: Status;
		first: boolean;
		last: boolean;
		/** the question whose dot sits here, on its first line */
		dot?: Thread;
	}

	const RANK: Record<Status, number> = { live: 3, error: 2, unread: 1, seen: 0 };

	/**
	 * The markers, by line: `hunk:index`, and in split layout `hunk:index:side`,
	 * on the side the question was asked on. Overlapping questions show the most
	 * pressing state.
	 */
	const marks = $derived.by(() => {
		const map = new Map<string, Mark>();
		for (const thread of fileThreads) {
			const a = thread.anchor;
			const hunk = hunks.find((h) => h.id === a.hunk);
			if (!hunk || !threads) continue;
			const status = threads.status(thread);
			// asked in unified layout: on the new side, unless only removed lines were picked
			const side: Side =
				a.side ??
				(hunk.lines.slice(a.start, a.end + 1).some((l) => l.new !== null) ? 'new' : 'old');
			const indexes: number[] = [];
			for (let i = a.start; i <= a.end; i++) {
				const line = hunk.lines[i];
				if (!line || !inSpan(a, i, line)) continue;
				if (layout === 'split' && (side === 'old' ? line.kind === 'add' : line.kind === 'del'))
					continue;
				indexes.push(i);
			}
			indexes.forEach((i, n) => {
				const key = layout === 'split' ? `${a.hunk}:${i}:${side}` : `${a.hunk}:${i}`;
				const before = map.get(key);
				map.set(key, {
					status: before && RANK[before.status] > RANK[status] ? before.status : status,
					first: n === 0 || (before?.first ?? false),
					last: n === indexes.length - 1 || (before?.last ?? false),
					dot: n === 0 ? thread : before?.dot
				});
			});
		}
		return map;
	});

	/** Hovering a dot for a moment peeks at its answer. */
	let peekTimer: ReturnType<typeof setTimeout> | undefined;
	function peekAt(event: PointerEvent, thread: Thread | null) {
		clearTimeout(peekTimer);
		if (!threads) return;
		if (!thread) {
			threads.peek = null;
			return;
		}
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		peekTimer = setTimeout(() => {
			if (threads) threads.peek = { id: thread.id, x: rect.left, y: rect.top };
		}, 300);
	}
	$effect(() => () => clearTimeout(peekTimer));

	/** Starts picking lines from a line number, shift-click extends the lines already picked. */
	function pick(event: PointerEvent, hunk: string, index: number, side?: Side) {
		if (!threads || event.button !== 0) return;
		event.preventDefault();
		const draft = threads.draft?.span;
		const extend = event.shiftKey && draft?.hunk === hunk && draft.side === side;
		const from = extend ? (index < draft.start ? draft.end : draft.start) : index;
		drag = { hunk, side, anchor: from };
		dragged = span(hunk, from, index, side);
		window.addEventListener('pointermove', dragTo);
		window.addEventListener('pointerup', drop, { once: true });
	}

	function dragTo(event: PointerEvent) {
		const row = document
			.elementFromPoint(event.clientX, event.clientY)
			?.closest<HTMLElement>('[data-index]');
		if (!drag || !row || row.dataset.hunk !== drag.hunk) return;
		if (drag.side && row.dataset.side !== drag.side) return;
		dragged = span(drag.hunk, drag.anchor, Number(row.dataset.index), drag.side);
	}

	function drop() {
		window.removeEventListener('pointermove', dragTo);
		if (dragged) threads?.select(dragged, section);
		drag = null;
		dragged = null;
	}

	$effect(() => () => window.removeEventListener('pointermove', dragTo));

	/** a text selection within one hunk, and where to offer asking about it */
	let offer = $state<{ span: LineSpan; top: number; left: number } | null>(null);

	/** Offers asking about the lines of a selection once it's made. */
	function offerSelection() {
		offer = null;
		const selected = threads && selectedSpan(root);
		if (!selected) return;
		const box = root.getBoundingClientRect();
		offer = {
			span: selected.span,
			top: selected.rect.bottom - box.top + 4,
			// kept clear of the markers down the card's right edge
			left: Math.max(8, Math.min(selected.rect.right - box.left - 40, box.width - 24 - 116))
		};
	}

	function acceptOffer() {
		if (!offer || !threads) return;
		threads.select(offer.span, section);
		offer = null;
		window.getSelection()?.removeAllRanges();
	}
</script>

<svelte:document
	onselectionchange={() => {
		if (offer && window.getSelection()?.isCollapsed) offer = null;
	}}
/>

<!-- the pointer handler only watches for text selections, the offer it shows is a button -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<section
	id={anchor ?? file.id}
	bind:this={root}
	class={[
		'relative overflow-clip rounded-xl border border-line bg-surface',
		inSection ? 'scroll-mt-38' : 'scroll-mt-28',
		threads && 'ask',
		threads && !picked && 'unpicked'
	]}
	onpointerup={() => {
		// a selection is only final once the button is up
		if (threads && !drag) setTimeout(offerSelection);
	}}
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
			onclick={toggle}
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
		{/if}
		{#if only && hunks.length < file.hunks.length}
			<span class="shrink-0 text-[11px] text-faint">
				{hunks.length} of {file.hunks.length} hunks
			</span>
		{/if}
		<span class="ml-auto flex shrink-0 items-center gap-3">
			{#if fileThreads.length}
				<button
					type="button"
					class="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted hover:bg-subtle hover:text-fg"
					title="{fileThreads.length} {fileThreads.length === 1
						? 'question'
						: 'questions'} to Claude in this file, open the first"
					onclick={() => threads?.openLens(fileThreads[0].id)}
				>
					<svg
						viewBox="0 0 16 16"
						class="size-3"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" /></svg
					>{fileThreads.length}
				</button>
			{/if}
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
					data-hunk-top={hunk.id}
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
										{@render cell(hunk, row.left, 'old')}
										{@render cell(hunk, row.right, 'new')}
									</div>
								{/each}
							</LazyBlock>
						{/each}
					</div>
				{:else}
					<div class="twinkleplop overflow-x-auto font-mono text-[12.5px] leading-5">
						<!-- gutter (6rem), marker (1.25rem), right padding (2rem) and the question
						     marker's slot (0.875rem) around the code -->
						<div
							class="w-max min-w-full"
							style:min-width="max(100%, calc({widths.get(hunk.id)}ch + 10.125rem))"
						>
							{#each chunk(hunk.lines, BLOCK) as lines, b (b)}
								<LazyBlock estimate={lines.length * ROW} lazy={virtualize}>
									{#each lines as line, i (i)}
										{@const index = b * BLOCK + i}
										{@const on = isPicked(hunk.id, index, line)}
										<div
											class={[
												'row flex',
												line.kind,
												tinted(line) && 'tinted',
												line.reformatted && 'reformatted',
												on && 'picked',
												cursor?.hunk === hunk.id && cursor.head === index && 'cursor'
											]}
											title={line.reformatted ? REFORMATTED : undefined}
											data-hunk={hunk.id}
											data-index={index}
										>
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<span
												class="gutter sticky left-0 flex w-24 shrink-0 text-right text-[11px] text-faint tabular-nums select-none"
												onpointerdown={(e) => pick(e, hunk.id, index)}
											>
												<span class="w-12 pr-2">{line.old ?? ''}</span>
												<span class="w-12 pr-2">{line.new ?? ''}</span>
												{@render plus()}
											</span>
											<!-- pinned beside the gutter, the one sign of a change that isn't a colour -->
											{@render marker(line, 'pinned sticky left-24')}
											<span class="text pr-8 whitespace-pre">{@render code(line)}</span>
											<!-- pinned to the visible right edge while the hunk scrolls sideways -->
											{@render slot(marks.get(`${hunk.id}:${index}`), on, 'sticky right-0 ml-auto')}
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

	{#if offer}
		<button
			type="button"
			class="absolute z-[5] flex h-[26px] items-center gap-1.5 rounded-lg border border-line bg-surface pr-2 pl-2.5 text-[12px] font-medium text-fg shadow-float hover:border-muted"
			style:top="{offer.top}px"
			style:left="{offer.left}px"
			onpointerdown={(e) => e.preventDefault()}
			onclick={acceptOffer}
		>
			Ask Claude
			<kbd class="font-mono text-[10.5px] font-normal text-faint">a</kbd>
		</button>
	{/if}
</section>

<!-- a question's marker: a line down the right edge of its lines, and on the first
     one a dot that peeks at the answer and opens it. Picked lines show where it'll go -->
{#snippet slot(mark: Mark | undefined, picking: boolean, place: string)}
	{#if threads}
		<span
			class={[
				'mk w-3.5 shrink-0 self-stretch',
				place,
				mark && ['on', `s-${mark.status}`, mark.first && 'first', mark.last && 'last'],
				picking && !mark && 'pick'
			]}
		>
			{#if mark?.dot}
				{@const dot = mark.dot}
				<button
					type="button"
					class={['dot', `s-${mark.status}`]}
					aria-label="Open the question about {dot.anchor.label}"
					onpointerenter={(e) => peekAt(e, dot)}
					onpointerleave={(e) => peekAt(e, null)}
					onclick={() => threads.openLens(dot.id)}
				></button>
			{/if}
		</span>
	{/if}
{/snippet}

{#snippet plus()}
	{#if threads}
		<span class="plus" aria-hidden="true">+</span>
	{/if}
{/snippet}

{#snippet marker(line: DiffLine, place: string)}
	<span class={['marker w-5 shrink-0 text-center select-none', place]}
		>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span
	>
{/snippet}

{#snippet code(line: DiffLine)}
	{@html line.html}{#if line.noNewline}<span
			class="ml-2 font-sans text-[10px] text-faint select-none"
			title="No newline at end of file">no newline</span
		>{/if}
{/snippet}

{#snippet cell(hunk: Hunk, line: DiffLine | null, side: Side)}
	{#if line}
		{@const index = lineIndex.get(line) ?? 0}
		{@const on = isPicked(hunk.id, index, line, side)}
		<div
			class={[
				'row flex min-w-0',
				line.kind,
				tinted(line) && 'tinted',
				line.reformatted && 'reformatted',
				side === 'old' && 'split-old',
				on && 'picked',
				cursor?.hunk === hunk.id &&
					cursor.head === index &&
					(cursor.side ?? 'new') === side &&
					'cursor'
			]}
			title={line.reformatted ? REFORMATTED : undefined}
			data-hunk={hunk.id}
			data-index={index}
			data-side={side}
		>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="gutter relative w-12 shrink-0 pr-2 text-right text-[11px] text-faint tabular-nums select-none"
				onpointerdown={(e) => pick(e, hunk.id, index, side)}
				>{side === 'old' ? line.old : line.new}{@render plus()}</span
			>
			{@render marker(line, '')}
			<span class="text min-w-0 flex-1 pr-4 break-all whitespace-pre-wrap"
				>{@render code(line)}</span
			>
			<!-- on the edge of the side the question was asked on -->
			{@render slot(marks.get(`${hunk.id}:${index}:${side}`), on, 'relative')}
		</div>
	{:else}
		<!-- no counterpart on this side -->
		<div class={['filler', side === 'old' && 'split-old']}></div>
	{/if}
{/snippet}

<style>
	/* the gutter says a line was added or removed, with a saturated edge against the
	   code. The code itself stays on the surface so the changed tokens are the only
	   colour in it, and only a line with no tokens marked gets a faint tint */
	.gutter {
		background: var(--surface);
		border-right: 1px solid var(--line);
	}

	.row.add {
		--hue: var(--add);
		--gutter-bg: var(--add-gutter);
		--number: var(--add-number);
		--row-bg: var(--add-bg);
	}
	.row.del {
		--hue: var(--del);
		--gutter-bg: var(--del-gutter);
		--number: var(--del-number);
		--row-bg: var(--del-bg);
	}
	.row:is(.add, .del) .gutter {
		background: var(--gutter-bg);
		color: var(--number);
		border-right-color: var(--hue);
	}
	.row:is(.add, .del) .marker {
		color: var(--hue);
	}
	.row.tinted {
		background: var(--row-bg);
	}

	/* opaque, so the code scrolls under it, and washed like the rest of its row */
	.marker.pinned {
		background: var(--surface);
		box-shadow: inherit;
	}
	.row.tinted .marker.pinned {
		background: inherit;
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

	/* changed according to git, but nothing new: re-indented or re-wrapped, so a
	   quieter gutter with no edge */
	.row.reformatted.add {
		--gutter-bg: var(--add-quiet);
	}
	.row.reformatted.del {
		--gutter-bg: var(--del-quiet);
	}
	.row.reformatted .gutter {
		border-right-color: var(--line);
	}
	.row.reformatted .text,
	.row.reformatted .marker {
		opacity: 0.5;
	}

	/* asking Claude, drawn in ink: line numbers pick lines, a faint + hints at it */
	.ask .gutter {
		cursor: pointer;
	}
	.plus {
		display: none;
		position: absolute;
		top: 3px;
		right: -7px;
		z-index: 1;
		width: 14px;
		height: 14px;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
		color: var(--muted);
		font: 11px/12px var(--font-sans);
		text-align: center;
		pointer-events: none;
	}
	.unpicked .row:hover .plus {
		display: block;
	}
	/* over whatever colour the line has, added, removed or reformatted */
	.row.picked {
		box-shadow: inset 0 0 0 100vmax var(--ink-wash);
	}
	.row.picked .gutter {
		background: color-mix(in oklab, var(--fg) 10%, var(--surface));
		color: var(--fg);
	}
	/* a darker shade of its own colour, so added and removed still tell apart */
	.row.picked:is(.add, .del) .gutter {
		background: color-mix(in oklab, var(--fg) 8%, var(--gutter-bg));
	}
	/* the keyboard cursor's line, on top of the pick's wash: a darker gutter with a
	   hairline down its left edge */
	.row.cursor .gutter {
		box-shadow: inset 1px 0 0 var(--fg);
		background: color-mix(in oklab, var(--fg) 16%, var(--surface));
		color: var(--fg);
	}
	.row.cursor:is(.add, .del) .gutter {
		background: color-mix(in oklab, var(--fg) 14%, var(--gutter-bg));
	}
	[data-index] {
		/* the keyboard cursor scrolls rows into view clear of the sticky bars */
		scroll-margin: 150px 0 40px;
	}

	/* a question's marker down the right edge of its lines */
	.mk {
		position: relative;
	}
	.mk.sticky {
		position: sticky;
	}
	.mk::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		right: 5px;
		width: 2px;
	}
	.mk.first::before {
		top: 3px;
		border-radius: 1px 1px 0 0;
	}
	.mk.last::before {
		bottom: 3px;
		border-radius: 0 0 1px 1px;
	}
	.mk.on::before {
		background: var(--ink-mark);
	}
	.mk.on.s-seen::before {
		background: var(--ink-mark-seen);
	}
	.mk.on.s-error::before {
		background: color-mix(in oklab, var(--del) 60%, transparent);
	}
	/* answering: a highlight runs down the line */
	.mk.on.s-live::before {
		background:
			linear-gradient(to bottom, transparent, var(--ink) 50%, transparent) 0 0 / 100% 40px repeat-y,
			var(--ink-mark-seen);
		animation: run 1.1s linear infinite;
	}
	@keyframes run {
		to {
			background-position:
				0 40px,
				0 0;
		}
	}
	.mk.pick::before {
		border-right: 2px dashed var(--ink-soft);
	}
	.dot {
		position: absolute;
		top: 2px;
		right: -2px;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		cursor: pointer;
	}
	.dot::after {
		content: '';
		box-sizing: border-box;
		width: 8px;
		height: 8px;
		border-radius: 99px;
		background: var(--ink);
		box-shadow: 0 0 0 2px var(--surface);
		transition: transform 0.12s;
	}
	.dot.s-seen::after {
		background: var(--surface);
		border: 2px solid var(--ink-mark);
	}
	.dot.s-live::after {
		animation: pulse 1.2s ease-in-out infinite;
	}
	.dot.s-error::after {
		background: var(--del);
	}
	.dot:hover::after {
		transform: scale(1.35);
	}
	@keyframes pulse {
		50% {
			box-shadow:
				0 0 0 2px var(--surface),
				0 0 0 5px var(--ink-soft);
		}
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
			var(--subtle) 12.5%,
			var(--surface) 12.5% 50%,
			var(--subtle) 50% 62.5%,
			var(--surface) 62.5%
		);
		background-size: 10px 10px;
	}
</style>
