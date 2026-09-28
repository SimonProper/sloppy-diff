<script lang="ts">
	import SidebarLayout from './SidebarLayout.svelte';
	import { tick, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { Layout } from '$lib/diff/split';
	import type { DiffFile } from '$lib/diff/types';
	import { KINDS, orderSections } from '$lib/guide/order';
	import type { Guide, GuideSection } from '$lib/guide/types';
	import { timeAgo } from '$lib/refs';
	import FileDiff from './FileDiff.svelte';
	import { Popover, PopoverContent, PopoverTrigger } from './popover';

	interface Props {
		guide: Guide;
		files: DiffFile[];
		toolbar?: Snippet;
		layout?: Layout;
		/** only render lines near the viewport, for big diffs */
		virtualize?: boolean;
		/** questions to Claude about lines of the diff */
		threads?: Threads;
	}

	let { guide, files, toolbar, layout = 'unified', virtualize = false, threads }: Props = $props();

	// sections read core first, whatever order they were written in
	const sections = $derived(orderSections(guide.sections));
	const number = $derived(new Map(sections.map((s, i) => [s.id, i + 1])));

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

	function counts(section: GuideSection) {
		let additions = 0;
		let deletions = 0;
		for (const id of section.hunks) {
			const hunk = hunkFile.get(id)?.hunks.find((h) => h.id === id);
			for (const l of hunk?.lines ?? []) {
				if (l.kind === 'add') additions++;
				else if (l.kind === 'del') deletions++;
			}
		}
		return { additions, deletions };
	}

	function fileHref(file: DiffFile) {
		const params = new URLSearchParams(page.url.searchParams);
		params.delete('view');
		return `?${params}#${file.id}`;
	}

	// reviewed sections are a per-browser convenience, so localStorage is enough. Keyed by
	// when the guide was written too: a regenerated guide's sections share ids with the
	// old one's, and must not show as reviewed with their diffs hidden
	const guideKey = $derived(`${guide.repo}:${guide.start}..${guide.stop}:${guide.createdAt}`);
	const storageKey = $derived(`sloppy-diff:reviewed:${guideKey}`);
	// read while rendering, so reviewed steps are collapsed before the page scrolls to a step
	let reviewed = $derived(load(storageKey));

	function load(key: string): string[] {
		try {
			return JSON.parse(localStorage.getItem(key) ?? '[]');
		} catch {
			return [];
		}
	}

	/** `advance` scrolls on to the next step left to review, used from the step itself */
	async function toggleReviewed(id: string, advance = true) {
		const done = !reviewed.includes(id);
		reviewed = done ? [...reviewed, id] : reviewed.filter((r) => r !== id);
		try {
			localStorage.setItem(storageKey, JSON.stringify(reviewed));
		} catch {
			// private windows can refuse storage, the state still works for this visit
		}
		if (done && advance) {
			// once the step has collapsed, or the scroll aims where the next step used to be
			await tick();
			const next = sections.find((s) => !reviewed.includes(s.id));
			if (next) document.getElementById(next.id)?.scrollIntoView({ behavior: 'smooth' });
		}
	}

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

	// its ⓘ is gone once the description is back in view or the step is reviewed, and
	// the panel mustn't pop open again by itself when the ⓘ returns
	$effect(() => {
		if (described && (!past[described] || reviewed.includes(described))) described = null;
	});

	const progress = $derived(
		sections.length ? sections.filter((s) => reviewed.includes(s.id)).length / sections.length : 0
	);

	// j / k step through sections
	function onkeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement;
		if (target.closest('input, textarea, [contenteditable], dialog')) return;
		if (event.key !== 'j' && event.key !== 'k') return;

		const headers = sections
			.map((s) => document.getElementById(s.id))
			.filter((el): el is HTMLElement => el !== null);
		// header plus the sticky changes bar, where a step's sticky title sits
		const offset = 92;
		const next =
			event.key === 'j'
				? headers.find((el) => el.getBoundingClientRect().top > offset + 4)
				: headers.findLast((el) => el.getBoundingClientRect().top < offset - 4);
		next?.scrollIntoView({ behavior: 'smooth' });
	}
</script>

<svelte:window {onkeydown} />

<SidebarLayout {layout} asideClass="overflow-y-auto">
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

		<nav class="flex flex-col gap-3 p-2">
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
							{@const done = reviewed.includes(section.id)}
							{@const c = counts(section)}
							<div class="group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-subtle">
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
									onclick={() => toggleReviewed(section.id, false)}
								>
									{#if done}
										{@render checkmark('')}
									{:else}
										<span class="group-hover/check:hidden">{number.get(section.id)}</span>
										{@render checkmark('hidden group-hover/check:block')}
									{/if}
								</button>
								<a href="#{section.id}" class="min-w-0 flex-1">
									<span
										class={[
											'line-clamp-2 text-[12.5px] leading-snug',
											done && 'text-muted line-through decoration-faint'
										]}>{section.title}</span
									>
									<span class="mt-0.5 flex items-center gap-1 font-mono text-[10.5px] tabular-nums">
										<span class="text-add">+{c.additions}</span>
										<span class="text-del">−{c.deletions}</span>
										{#if threads}
											{@const asked = threads.in(section.hunks)}
											{#if asked.length}
												<span class="text-faint" title="Questions to Claude in this section"
													>· {asked.length} ?</span
												>
												{#if asked.some((t) => threads.live[t.id])}
													<span class="answering size-1.5 rounded-full bg-ink"></span>
												{/if}
											{/if}
										{/if}
									</span>
								</a>
							</div>
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
					{@const done = reviewed.includes(section.id)}
					<button
						type="button"
						class={[
							'grid size-[18px] shrink-0 place-items-center rounded-full border text-[10px] font-medium tabular-nums',
							done
								? 'border-add bg-add text-surface hover:opacity-80'
								: 'border-line text-muted hover:border-muted hover:text-fg'
						]}
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

	<main class="flex min-w-0 flex-col gap-10 p-4 pb-40">
		{@render toolbar?.()}
		<div class="-mt-4 rounded-xl border border-line bg-surface p-5">
			<h1 class="text-[17px] font-semibold tracking-tight">{guide.title}</h1>
			<div class="prose mt-2 text-[13.5px] leading-relaxed text-muted">
				{@html guide.summaryHtml}
			</div>
			<p class="mt-4 flex items-center gap-1.5 text-[11px] text-faint">
				Use
				<kbd class="rounded border border-line px-1 font-mono text-[10.5px] text-muted">j</kbd>
				<kbd class="rounded border border-line px-1 font-mono text-[10.5px] text-muted">k</kbd>
				to move between sections.
			</p>
		</div>

		{#each sections as section (section.id)}
			{@const done = reviewed.includes(section.id)}
			<!-- the id is on the step, its title sticks under the changes bar while the step is on screen -->
			<article id={section.id} class="flex scroll-mt-23 flex-col gap-3">
				<!-- a direct child of the step, so it stays stuck through all of the step's diffs -->
				<header
					class="sticky top-23 z-[12] -mx-4 flex h-11 items-center gap-2.5 border-b border-line bg-canvas/85 px-5 backdrop-blur"
				>
					<span
						class="grid size-6 shrink-0 place-items-center rounded-full border border-line text-[11px] font-medium text-muted tabular-nums"
						>{number.get(section.id)}</span
					>
					<h2 class={['min-w-0 text-[15px] font-semibold tracking-tight', done && 'text-muted']}>
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
					{#if past[section.id] && !done}
						<!-- the description once it has scrolled away, over the diff rather than pushing it -->
						<Popover
							bind:open={
								() => described === section.id, (open) => (described = open ? section.id : null)
							}
						>
							<PopoverTrigger
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
							</PopoverTrigger>
							<PopoverContent
								onpointerenter={(e) => hover(e, section.id)}
								onpointerleave={(e) => hover(e, null)}
								class="max-h-[60vh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.25)]"
							>
								{@render description(section)}
							</PopoverContent>
						</Popover>
					{/if}
					<span class="flex-1"></span>
					<span
						class={[
							'shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium',
							section.kind === 'core' && 'bg-accent/10 text-accent',
							section.kind === 'supporting' && 'bg-subtle text-muted',
							section.kind === 'chore' && 'text-faint'
						]}>{section.kind}</span
					>
					<button
						type="button"
						class={[
							'flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium',
							done
								? 'border-add/40 bg-add/10 text-add'
								: 'border-line bg-surface text-muted hover:border-muted hover:text-fg'
						]}
						onclick={() => toggleReviewed(section.id)}
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
				</header>

				{#if !done}
					<div class="pr-1 pl-[35px]" {@attach trackPast(section.id)}>
						{@render description(section)}
					</div>
				{/if}

				{#if !done}
					{#each groups(section) as { file, ids } (file.id)}
						<FileDiff
							{file}
							only={ids}
							notes={section.notes}
							anchor="{section.id}-{file.id}"
							href={fileHref(file)}
							inSection
							{layout}
							{virtualize}
							{threads}
							section={section.id}
							remember="{guideKey}:{section.id}"
						/>
					{/each}
				{/if}
			</article>
		{/each}
	</main>
</SidebarLayout>

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
				<span class="rounded-[4px] bg-subtle px-1 font-mono text-[10.5px] text-accent">{sha}</span>
			{/each}
		</p>
	{/if}
{/snippet}

<style>
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
