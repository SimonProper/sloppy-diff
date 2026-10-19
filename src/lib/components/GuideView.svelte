<script lang="ts">
	import SidebarLayout, { diffWidth } from './SidebarLayout.svelte';
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { Layout } from '$lib/diff/split';
	import type { DiffFile } from '$lib/diff/types';
	import { columnsOf, lineStats } from '$lib/diff/hunks';
	import { KINDS, orderSections } from '$lib/guide/order';
	import type { Guide, GuideSection } from '$lib/guide/types';
	import { typing } from '$lib/keys';
	import { timeAgo } from '$lib/refs';
	import { reveal, scrollSpy } from '$lib/scroll-spy.svelte';
	import { readJson, writeJson } from '$lib/storage';
	import FileDiff from './FileDiff.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import StepChip, { type Step } from './StepChip.svelte';
	import { displayPath, splitPath } from '$lib/diff/path';
	import Popover from './Popover.svelte';
	import type { ReviewThread } from '$lib/pr/types';

	interface Props {
		guide: Guide;
		files: DiffFile[];
		/** the shared page chrome above the guide and its sidebar */
		stickyTop?: number;
		layout?: Layout;
		/** only render lines near the viewport, for big diffs */
		virtualize?: boolean;
		/** questions to the agent about lines of the diff */
		threads?: Threads;
		/** a pull request's review threads */
		review?: ReviewThread[];
		/** writes a new guide, offered when this one was for an earlier version */
		onregenerate?: () => void;
		/** a column at the right, the question panel */
		panel?: Snippet;
		panelWidth?: number | null;
		/** closes the question panel, for the sidebar kept open where there's no room for both */
		onpanelclose?: () => void;
	}

	let {
		guide,
		files,
		stickyTop = 92,
		layout = 'unified',
		virtualize = false,
		threads,
		review,
		onregenerate,
		panel,
		panelWidth = $bindable(null),
		onpanelclose
	}: Props = $props();

	// sections read core first, whatever order they were written in
	const sections = $derived(orderSections(guide.sections));
	const number = $derived(new Map(sections.map((s, i) => [s.id, i + 1])));

	// the step on screen, marked in the sidebar and kept in view there
	const reading = scrollSpy(() => sections.map((s) => s.id));
	let stepList = $state<HTMLElement>();
	$effect(() => {
		const id = reading.current;
		const row = id && stepList?.querySelector<HTMLElement>(`[data-step="${CSS.escape(id)}"]`);
		if (row) reveal(row);
	});

	const hunkFile = $derived(new Map(files.flatMap((f) => f.hunks.map((h) => [h.id, f] as const))));

	/** A section's hunks grouped by file, files in the order the section first mentions them. */
	function groups(section: GuideSection) {
		const byFile = new Map<string, { file: DiffFile; ids: string[] }>();
		for (const id of section.hunks) {
			const file = hunkFile.get(id);
			if (!file) continue;
			const group = byFile.get(file.id) ?? { file, ids: [] };
			group.ids.push(id);
			byFile.set(file.id, group);
		}
		return [...byFile.values()];
	}

	// one file can be split across steps, each showing only its own hunks. Every step
	// it's read in, in reading order, so each can point to the others
	const fileSteps = $derived.by(() => {
		const steps = new Map<string, GuideSection[]>();
		for (const s of sections)
			for (const { file } of groups(s)) steps.set(file.id, [...(steps.get(file.id) ?? []), s]);
		return steps;
	});

	/** The other steps `file` is read in, to jump to it there. */
	function also(section: GuideSection, file: DiffFile): Step[] {
		return (fileSteps.get(file.id) ?? [])
			.filter((s) => s !== section)
			.map((s) => ({
				n: number.get(s.id)!,
				title: s.title,
				href: `#${s.id}-${file.id}`,
				done: isReviewed(s)
			}));
	}

	function counts(section: GuideSection) {
		return lineStats(
			section.hunks.flatMap((id) => hunkFile.get(id)?.hunks.find((h) => h.id === id) ?? [])
		);
	}

	function fileHref(file: DiffFile) {
		const params = new URLSearchParams(page.url.searchParams);
		params.set('view', 'files'); // not dropped: a pull request's default tab is its overview
		return `?${params}#${file.id}`;
	}

	// reviewed files are a per-browser convenience, so localStorage is enough. Keyed by
	// when the guide was written too: a regenerated guide's sections share ids with the
	// old one's, and must not show as reviewed with their diffs hidden
	const guideKey = $derived(`${guide.repo}:${guide.start}..${guide.stop}:${guide.createdAt}`);
	const storageKey = $derived(`sloppy-diff:reviewed:${guideKey}`);
	// read while rendering, so reviewed files are folded before the page scrolls to a step
	let reviewed = $derived(readJson<string[]>(storageKey, []));

	type Group = { file: DiffFile; ids: string[] };
	// a file is reviewed in a step with the hunks it had there then, one they've changed
	// in since isn't. A whole step's mark is from before files were reviewed one by one
	const mark = (section: GuideSection) => `${section.id} ${section.hunks.join(' ')}`;
	const fileMark = (section: GuideSection, { file, ids }: Group) =>
		`${section.id}/${file.id} ${ids.join(' ')}`;
	const isFileReviewed = (section: GuideSection, group: Group) =>
		reviewed.includes(fileMark(section, group)) || reviewed.includes(mark(section));
	/** A step is reviewed once all of its files are. */
	const isReviewed = (section: GuideSection) => {
		const all = groups(section);
		return (
			reviewed.includes(mark(section)) ||
			(all.length > 0 && all.every((g) => isFileReviewed(section, g)))
		);
	};

	function setReviewed(section: GuideSection, files: Group[], on: boolean) {
		// a whole step's mark is spread over its files first, so one can be taken back
		let next = reviewed.includes(mark(section))
			? [
					...reviewed.filter((r) => r !== mark(section)),
					...groups(section).map((g) => fileMark(section, g))
				]
			: reviewed;
		const marks = files.map((g) => fileMark(section, g));
		next = next.filter((r) => !marks.includes(r));
		reviewed = on ? [...next, ...marks] : next;
		writeJson(storageKey, reviewed);
	}

	/**
	 * Marks all of a step's files, or none. Read partway down, the files above fold
	 * and the page would land further on, so it goes back to the step's top instead.
	 */
	async function toggleReviewed(section: GuideSection) {
		const step = document.getElementById(section.id);
		const into = step && step.getBoundingClientRect().top < stickyTop;
		setReviewed(section, groups(section), !isReviewed(section));
		await tick();
		if (into) step.scrollIntoView({ behavior: 'instant' });
	}

	// each step's files in the sidebar, open until it's reviewed unless the reader
	// opened or closed them, which is remembered like reviewed steps are
	const listsKey = $derived(`sloppy-diff:step-files:${guideKey}`);
	let lists = $derived(readJson<Record<string, boolean>>(listsKey, {}));
	const listed = (section: GuideSection) => lists[section.id] ?? !isReviewed(section);

	function toggleList(section: GuideSection) {
		lists = { ...lists, [section.id]: !listed(section) };
		writeJson(listsKey, lists);
	}

	// with room beside the diffs, each step's title, description and files sit in a
	// column of their own that stays beside its diffs: the room the diffs keep beside the
	// panels (their longest line, see SidebarLayout), the step's column (28rem) and the
	// gap between (4rem). Never at the cost of the diffs' room
	const chars = $derived(columnsOf(files));
	let mainWidth = $state(0);
	const wide = $derived(mainWidth - 32 >= diffWidth(layout, chars) + 32 * 16);

	// stuck, a step's column sits in the middle of the screen below the page's header,
	// at the top once it's as tall as that
	let innerHeight = $state(0);
	let columnHeights = $state<Record<string, number>>({});
	const columnTop = (id: string) =>
		stickyTop + Math.max(16, (innerHeight - stickyTop - (columnHeights[id] ?? 0)) / 2);
	const pad = (n: number) => String(n).padStart(2, '0');

	/** steps whose description has scrolled up under their sticky title */
	let past = $state<Record<string, boolean>>({});

	/** Keeps `past` up to date for one step's description. */
	function trackPast(id: string) {
		return (el: HTMLElement) => {
			// the page header, the changes bar and the step's sticky title
			const covered = 136;
			const observer = new IntersectionObserver(
				([entry]) => {
					const top = entry.rootBounds?.top ?? covered;
					past[id] = !entry.isIntersecting && entry.boundingClientRect.top < top;
				},
				{ rootMargin: `-${covered}px 0px 0px 0px` }
			);
			observer.observe(el);
			return () => {
				observer.disconnect();
				delete past[id];
			};
		};
	}

	// a description opens while its ⓘ or the panel itself is hovered. The close
	// waits a moment so the pointer can cross from one to the other
	let described = $state<string | null>(null);
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;

	function hover(event: PointerEvent, id: string | null) {
		// touch has no hover, a tap toggles it like a click
		if (event.pointerType === 'touch') return;
		clearTimeout(hoverTimer);
		hoverTimer = setTimeout(() => (described = id), id ? 120 : 200);
	}

	$effect(() => () => clearTimeout(hoverTimer));

	// its ⓘ is gone once the description is back in view, and
	// the panel mustn't pop open again by itself when the ⓘ returns
	$effect(() => {
		const open = sections.find((s) => s.id === described);
		if (open && !past[open.id]) described = null;
	});

	const progress = $derived(
		sections.length ? sections.filter(isReviewed).length / sections.length : 0
	);

	// j / k step through sections
	function onkeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (typing(event)) return;
		if (event.key !== 'j' && event.key !== 'k') return;

		const headers = sections
			.map((s) => document.getElementById(s.id))
			.filter((el): el is HTMLElement => el !== null);
		// header plus the sticky changes bar, where a step's sticky title sits
		const offset = stickyTop;
		const next =
			event.key === 'j'
				? headers.find((el) => el.getBoundingClientRect().top > offset + 4)
				: headers.findLast((el) => el.getBoundingClientRect().top < offset - 4);
		next?.scrollIntoView({ behavior: 'smooth' });
	}
</script>

<svelte:window {onkeydown} bind:innerHeight />

<SidebarLayout
	{layout}
	{chars}
	{stickyTop}
	asideClass="overflow-y-auto"
	{panel}
	bind:panelWidth
	{onpanelclose}
>
	{#snippet aside()}
		<div class="border-b border-line p-4">
			<p class="text-[13px] leading-snug font-medium">{guide.title}</p>
			<p class="mt-1 text-[11px] text-faint">
				{sections.length} sections · {guide.model} · {timeAgo(guide.createdAt)} ago
			</p>
			<div class="mt-3 flex items-center gap-2">
				<div class="h-1 flex-1 overflow-hidden rounded-full bg-line">
					<div
						class="h-full rounded-full bg-accent transition-[width]"
						style:width="{progress * 100}%"
					></div>
				</div>
				<span class="text-[11px] text-muted tabular-nums">
					{Math.round(progress * sections.length)}/{sections.length}
				</span>
			</div>
		</div>

		<nav bind:this={stepList} class="flex flex-col gap-3 p-2">
			{#each KINDS as { kind, label } (kind)}
				{@const group = sections.filter((s) => s.kind === kind)}
				{#if group.length}
					<div>
						<p
							class="px-2 pt-1 pb-1.5 text-[10.5px] font-medium tracking-wide text-faint uppercase"
						>
							{label}
						</p>
						{#each group as section (section.id)}
							{@const done = isReviewed(section)}
							{@const c = counts(section)}
							{@const here = section.id === reading.current}
							<div
								class={[
									'group relative flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-subtle',
									here && 'current bg-subtle'
								]}
								data-step={section.id}
							>
								<!-- the number doubles as the checkbox, hovering shows the tick it would set -->
								<button
									type="button"
									class={[
										'group/check mt-px grid size-[18px] shrink-0 place-items-center rounded-full border text-[10px] font-medium tabular-nums',
										done
											? 'border-add bg-add text-surface hover:opacity-80'
											: 'border-line text-muted hover:border-add hover:text-add'
									]}
									title={done ? 'Mark as not reviewed' : 'Mark reviewed'}
									aria-label="{done ? 'Mark as not reviewed' : 'Mark reviewed'}: {section.title}"
									aria-pressed={done}
									onclick={() => toggleReviewed(section)}
								>
									{#if done}
										{@render checkmark('')}
									{:else}
										<span class="group-hover/check:hidden">{number.get(section.id)}</span>
										{@render checkmark('hidden group-hover/check:block')}
									{/if}
								</button>
								<a
									href="#{section.id}"
									class="min-w-0 flex-1"
									aria-current={here ? 'location' : undefined}
								>
									<span
										class={[
											'line-clamp-2 text-[12.5px] leading-snug',
											done && 'text-muted line-through decoration-faint'
										]}>{section.title}</span
									>
									<span class="mt-0.5 flex items-center gap-1 font-mono text-[10.5px] tabular-nums">
										<span class="text-add">+{c.additions}</span>
										<span class="text-del">−{c.deletions}</span>
										{#if guide.earlier && section.changed}
											<span class="text-faint" title="Its code changed since the guide was written"
												>· changed</span
											>
										{/if}
										{#if threads}
											{@const asked = threads.in(section.hunks)}
											{#if asked.length}
												<span class="text-faint" title="Questions to AI in this section"
													>· {asked.length} ?</span
												>
												{#if asked.some((t) => threads.live[t.id])}
													<span class="answering size-1.5 rounded-full bg-ink"></span>
												{/if}
											{/if}
										{/if}
									</span>
								</a>
								<!-- beside the diffs, each step's own column lists its files -->
								{#if !wide}
									<button
										type="button"
										class="mt-px grid size-[18px] shrink-0 place-items-center rounded-md text-faint hover:bg-line hover:text-fg"
										aria-expanded={listed(section)}
										aria-label="{listed(section) ? 'Hide' : 'Show'} the files of {section.title}"
										title={listed(section) ? 'Hide its files' : 'Show its files'}
										onclick={() => toggleList(section)}
									>
										<svg
											viewBox="0 0 16 16"
											class={['size-3 transition-transform', !listed(section) && '-rotate-90']}
											fill="none"
											stroke="currentColor"
											stroke-width="1.5"
											stroke-linecap="round"
											stroke-linejoin="round"><path d="m4 6 4 4 4-4" /></svg
										>
									</button>
								{/if}
							</div>
							{#if !wide && listed(section)}
								<!-- each step's files, to jump to one -->
								<div class="flex flex-col pb-1 pl-[30px]">{@render fileRows(section)}</div>
							{/if}
						{/each}
					</div>
				{/if}
			{/each}
		</nav>
	{/snippet}
	{#snippet rail()}
		<!-- the progress, then each step's number to jump to it, reviewed ones ticked -->
		<span
			class="pb-1 text-[10px] text-muted tabular-nums"
			data-tip="{Math.round(progress * sections.length)} of {sections.length} reviewed"
			>{Math.round(progress * sections.length)}/{sections.length}</span
		>
		{#each KINDS as { kind, label } (kind)}
			{@const group = sections.filter((s) => s.kind === kind)}
			{#if group.length}
				<span class="my-1 h-px w-4 shrink-0 bg-line" data-tip={label}></span>
				{#each group as section (section.id)}
					{@const done = isReviewed(section)}
					{@const here = section.id === reading.current}
					<button
						type="button"
						class={[
							'grid size-[18px] shrink-0 place-items-center rounded-full border text-[10px] font-medium tabular-nums',
							done
								? 'border-add bg-add text-surface hover:opacity-80'
								: here
									? 'border-muted bg-subtle text-fg'
									: 'border-line text-muted hover:border-muted hover:text-fg'
						]}
						aria-current={here ? 'location' : undefined}
						aria-label={section.title}
						data-tip={section.title}
						onclick={() => document.getElementById(section.id)?.scrollIntoView()}
					>
						{#if done}{@render checkmark('')}{:else}{number.get(section.id)}{/if}
					</button>
				{/each}
			{/if}
		{/each}
	{/snippet}

	<main
		class={['flex min-w-0 flex-col p-4 pb-40', wide ? 'gap-24' : 'gap-16']}
		bind:clientWidth={mainWidth}
	>
		<!-- clipped to its corners, so a header band can run edge to edge -->
		<div
			class={[
				'page-column overflow-clip rounded-xl border border-line bg-surface',
				// as wide as the steps below it
				wide ? ['two-col', layout] : layout === 'unified' && 'narrow'
			]}
		>
			{#if guide.earlier}
				<!-- a band across the top of the card, set apart by its surface: hues mean the diff -->
				<div
					class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-subtle px-5 py-2 text-[12px] text-muted"
				>
					<svg
						viewBox="0 0 16 16"
						class="size-3.5 shrink-0 text-faint"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5V5H5" /><path
							d="M8 5.5V8l1.75 1.25"
						/></svg
					>
					<span>
						<span class="font-medium text-fg">Written for an earlier version of this branch.</span>
						{#if guide.changed}
							{guide.changed}
							{guide.changed === 1 ? 'step has' : 'steps have'} changed since, their descriptions may
							be out of date.
						{/if}
					</span>
					<span class="flex-1"></span>
					{#if onregenerate}
						<button
							type="button"
							class="flex h-6 shrink-0 items-center rounded-md border border-faint px-2 text-[11.5px] font-medium text-fg transition-transform hover:border-muted active:scale-[0.97]"
							onclick={onregenerate}>Regenerate</button
						>
					{/if}
				</div>
			{/if}
			<div class="p-5">
				<h1 class="text-[17px] font-semibold tracking-tight">{guide.title}</h1>
				<div class="prose mt-2 text-[13.5px] leading-relaxed text-muted">
					{@html guide.summaryHtml}
				</div>
				<p class="mt-4 flex items-center gap-1.5 text-[11px] text-faint">
					Use
					<kbd class="rounded-sm border border-line px-1 font-mono text-[10.5px] text-muted">j</kbd>
					<kbd class="rounded-sm border border-line px-1 font-mono text-[10.5px] text-muted">k</kbd>
					to move between sections.
				</p>
			</div>
		</div>

		{#each sections as section (section.id)}
			{@const done = isReviewed(section)}
			{#if wide}
				<!-- what the step is about in a column of its own, staying beside its diffs -->
				<article id={section.id} class={['page-column two-col grid scroll-mt-23 gap-16', layout]}>
					<div
						class="sticky flex flex-col gap-3 self-start overflow-x-hidden overflow-y-auto pb-1"
						style:top="{columnTop(section.id)}px"
						bind:clientHeight={columnHeights[section.id]}
						style:max-height="calc(100vh - {stickyTop + 32}px)"
					>
						<p class="flex items-center gap-2 text-[11px] text-faint tabular-nums">
							{pad(number.get(section.id)!)} / {pad(sections.length)}
							<span class="flex-1"></span>
							{@render badges(section)}
						</p>
						<h2 class={['-mt-2 text-[16px] font-semibold tracking-tight', done && 'text-muted']}>
							{section.title}
						</h2>
						{@render description(section)}
						<div class="-mx-1.5 flex flex-col">{@render fileRows(section)}</div>
						<div>{@render reviewButton(section, done)}</div>
					</div>
					<div class="flex min-w-0 flex-col gap-4">{@render diffs(section, false)}</div>
				</article>
			{:else}
				<!-- the id is on the step, its title sticks under the changes bar while the step is on screen -->
				<article id={section.id} class="flex scroll-mt-23 flex-col">
					<!-- a direct child of the step, so it stays stuck through all of the step's diffs -->
					<header class="sticky top-23 z-[12] -mx-4 border-b border-line bg-canvas px-5">
						<!-- the line runs across the page, what's on it stays in the step's column -->
						<div
							class={[
								'page-column flex h-11 items-center gap-2.5',
								layout === 'unified' && 'narrow'
							]}
						>
							<span
								class="grid size-6 shrink-0 place-items-center rounded-full border border-line text-[11px] font-medium text-muted tabular-nums"
								>{number.get(section.id)}</span
							>
							<h2
								class={['min-w-0 text-[15px] font-semibold tracking-tight', done && 'text-muted']}
							>
								<!-- back to the top of the step, for the description in place -->
								<button
									type="button"
									class="block max-w-full truncate text-left"
									title={section.title}
									onclick={() =>
										document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth' })}
									>{section.title}</button
								>
							</h2>
							{#if past[section.id]}
								<!-- the description once it has scrolled away, over the diff rather than pushing it -->
								<Popover
									bind:open={
										() => described === section.id, (open) => (described = open ? section.id : null)
									}
									onpointerenter={(e) => hover(e, section.id)}
									onpointerleave={(e) => hover(e, null)}
									class="max-h-[60vh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-float"
								>
									{#snippet trigger(props)}
										<button
											{...props}
											onpointerenter={(e) => hover(e, section.id)}
											onpointerleave={(e) => hover(e, null)}
											onclick={(e) => {
												// already open from hovering, the click keeps it open rather than closing it
												if (described === section.id) e.preventDefault();
											}}
											class="grid size-6 shrink-0 place-items-center rounded-md text-faint hover:bg-subtle hover:text-fg aria-expanded:bg-subtle aria-expanded:text-fg"
											title="Show what this step is about"
											aria-label="Show the description of {section.title}"
										>
											<svg
												viewBox="0 0 16 16"
												class="size-3.5"
												fill="none"
												stroke="currentColor"
												stroke-width="1.5"
												stroke-linecap="round"
												><circle cx="8" cy="8" r="6" /><path d="M8 7.5v3.5M8 5v.01" /></svg
											>
										</button>
									{/snippet}
									{@render description(section)}
								</Popover>
							{/if}
							<span class="flex-1"></span>
							{@render badges(section)}
							{@render reviewButton(section, done)}
						</div>
					</header>
					<div class="flex flex-col gap-3 pt-3">
						<div
							class={['page-column pr-1 pl-[35px]', layout === 'unified' && 'narrow']}
							{@attach trackPast(section.id)}
						>
							{@render description(section)}
						</div>
						{@render diffs(section, true)}
					</div>
				</article>
			{/if}
		{/each}
	</main>
</SidebarLayout>

{#snippet badges(section: GuideSection)}
	{#if guide.earlier && section.changed}
		<span
			class="shrink-0 rounded-sm border border-line px-1 text-[10px] font-medium text-muted"
			title="Its code changed since the guide was written, the description may be out of date"
			>changed</span
		>
	{/if}
	<span
		class={[
			'shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium',
			section.kind === 'core' && 'bg-accent/10 text-accent',
			section.kind === 'supporting' && 'bg-subtle text-muted',
			section.kind === 'chore' && 'text-faint'
		]}>{section.kind}</span
	>
{/snippet}

{#snippet reviewButton(section: GuideSection, done: boolean)}
	<button
		type="button"
		class={[
			'flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium shadow-raised active:shadow-pressed',
			done
				? 'border-add/40 bg-add/10 text-add'
				: 'border-line bg-surface text-muted hover:border-muted hover:text-fg'
		]}
		onclick={() => toggleReviewed(section)}
	>
		<svg
			viewBox="0 0 16 16"
			class="size-3"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg
		>
		{done ? 'Reviewed' : 'Mark reviewed'}
	</button>
{/snippet}

{#snippet diffs(section: GuideSection, inSection: boolean)}
	{#each groups(section) as group (group.file.id)}
		<FileDiff
			file={group.file}
			only={group.ids}
			also={also(section, group.file)}
			reviewed={isFileReviewed(section, group)}
			onreviewed={(on) => setReviewed(section, [group], on)}
			notes={section.notes}
			anchor="{section.id}-{group.file.id}"
			href={fileHref(group.file)}
			{inSection}
			floating={!inSection}
			{layout}
			{virtualize}
			{threads}
			{review}
			section={section.id}
			remember="{guideKey}:{section.id}"
		/>
	{/each}
{/snippet}

<!-- a step's files, to jump to one in it and tick it reviewed -->
{#snippet fileRows(section: GuideSection)}
	{#each groups(section) as group (group.file.id)}
		{@const { file, ids } = group}
		{@const path = splitPath(displayPath(file))}
		{@const done = isFileReviewed(section, group)}
		<div class="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] hover:bg-subtle">
			<StatusBadge status={file.status} />
			<a
				href="#{section.id}-{file.id}"
				class={[
					'min-w-0 flex-1 truncate font-mono hover:text-fg',
					done ? 'text-faint' : 'text-muted'
				]}
				title={displayPath(file)}>{path.name}</a
			>
			{#if ids.length < file.hunks.length}
				<span
					class="shrink-0 font-mono text-[10.5px] text-faint tabular-nums"
					title="{ids.length} of the file's {file.hunks.length} hunks are in this step"
					>{ids.length}/{file.hunks.length}</span
				>
			{/if}
			{#each also(section, file) as step (step.n)}<StepChip {...step} />{/each}
			<button
				type="button"
				class={[
					'grid size-4 shrink-0 place-items-center rounded-sm',
					done ? 'text-add hover:opacity-80' : 'text-line hover:text-muted'
				]}
				aria-pressed={done}
				aria-label="{done ? 'Mark as not reviewed' : 'Mark reviewed'}: {displayPath(file)}"
				title={done ? 'Mark as not reviewed' : 'Mark reviewed'}
				onclick={() => setReviewed(section, [group], !done)}
			>
				{@render checkmark('size-3')}
			</button>
		</div>
	{/each}
{/snippet}

{#snippet checkmark(className: string)}
	<svg
		viewBox="0 0 16 16"
		class={['size-2.5', className]}
		fill="none"
		stroke="currentColor"
		stroke-width="2.5"
		stroke-linecap="round"
		stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg
	>
{/snippet}

{#snippet description(section: GuideSection)}
	<div class="prose max-w-3xl text-[13.5px] leading-relaxed">
		{@html section.html}
	</div>
	{#if section.commits.length}
		<p class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
			from
			{#each section.commits as sha (sha)}
				<span class="rounded-sm bg-subtle px-1 font-mono text-[10.5px] text-accent">{sha}</span>
			{/each}
		</p>
	{/if}
{/snippet}

<style>
	/* the step on screen, a bar at the row's edge */
	.current::before {
		content: '';
		position: absolute;
		inset-block: 6px;
		left: 0;
		width: 2px;
		border-radius: 1px;
		background: var(--accent);
	}
	/* a step's column and its diffs beside it, centred as one. The diffs get their
	   width first, the step's column what's left of the cap, from 28rem up to 40rem */
	.two-col {
		--cap: 104rem;
		grid-template-columns: minmax(28rem, 1fr) minmax(0, 60rem);
	}
	.two-col.split {
		--cap: 164rem;
		grid-template-columns: minmax(28rem, 1fr) minmax(0, 120rem);
	}
	/* picked in the View settings, the diffs fill the space between the panels */
	:global(.full-width) .two-col {
		--cap: 100%;
		grid-template-columns: 28rem minmax(0, 1fr);
	}
	/* a question in the section is being answered */
	.answering {
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
</style>
