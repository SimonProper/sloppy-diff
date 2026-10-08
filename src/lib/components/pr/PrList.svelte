<script lang="ts">
	import { goto } from '$app/navigation';
	import { listNav } from '$lib/list-nav';
	import { timeAgo } from '$lib/refs';
	import { remember } from '$lib/prefs';
	import type { PrSummary, PrView } from '$lib/pr/types';
	import SegmentedControl from '../SegmentedControl.svelte';

	interface Props {
		/** null when gh couldn't list them, undefined while they load */
		prs: PrSummary[] | null | undefined;
		/** where picking one goes */
		href: (number: number) => string;
		/** the view picked last time */
		view: PrView;
		/** in a sidebar beside a pull request, narrow and scrolling on its own */
		compact?: boolean;
		/** the pull request on screen */
		current?: number;
	}

	let { prs, href, view = $bindable(), compact = false, current }: Props = $props();

	const VIEWS: { value: PrView; label: string; empty: string; keep: (p: PrSummary) => boolean }[] =
		[
			{ value: 'all', label: 'All', empty: 'No open pull requests', keep: () => true },
			{
				value: 'review',
				label: 'To review',
				empty: 'Nothing waiting on your review',
				keep: (p) => p.requested
			},
			{
				value: 'mine',
				label: 'Mine',
				empty: 'You have no open pull requests',
				keep: (p) => p.mine
			}
		];
	const PILLS = {
		APPROVED: ['approved', 'border-add/40 bg-add/10 text-add'],
		CHANGES_REQUESTED: ['changes requested', 'border-del/40 bg-del/10 text-del']
	} as const;
	const REVIEWED = {
		APPROVED: 'you approved',
		CHANGES_REQUESTED: 'you requested changes',
		COMMENTED: 'you commented'
	} as const;

	let query = $state('');
	let active = $state(0);
	// beside a pull request the row under the arrows shows only while filtering, the one on
	// screen is marked instead
	let filtering = $state(false);
	const marking = $derived(!compact || filtering);
	let list = $state<HTMLElement>();
	const listId = $props.id();

	const counts = $derived(
		Object.fromEntries(VIEWS.map((v) => [v.value, (prs ?? []).filter(v.keep).length]))
	);
	const picked = $derived(VIEWS.find((v) => v.value === view) ?? VIEWS[0]);
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const inView = (prs ?? []).filter(picked.keep);
		if (!q) return inView;
		return inView.filter((p) =>
			`${p.title} #${p.number} ${p.author} ${p.baseRefName} ${p.headRefName}`
				.toLowerCase()
				.includes(q)
		);
	});

	function onkeydown(event: KeyboardEvent) {
		listNav(event, {
			active,
			count: shown.length,
			list,
			onmove: (i) => (active = i),
			onenter: () => {
				const pr = shown[active];
				if (pr) goto(href(pr.number));
			}
		});
	}

	function choose(value: PrView) {
		view = value;
		// the picker's view is remembered, a sidebar's starts on all of them
		if (!compact) remember('prs', value);
		active = 0;
	}
</script>

<!-- as wide as the diff it opens, up to a wide screen. In a sidebar, the list scrolls inside -->
<div
	class={compact
		? 'flex min-h-0 flex-1 flex-col'
		: 'mx-auto flex w-full max-w-screen-2xl flex-col p-4'}
>
	<p
		class={[
			'pb-2 text-[10.5px] font-medium tracking-wide text-faint uppercase',
			compact ? 'px-3' : 'px-1'
		]}
	>
		Open pull requests
	</p>
	{#if prs === undefined}
		<p
			class={[
				'animate-pulse px-4 py-6 text-center text-[12.5px] text-muted',
				!compact && 'rounded-xl border border-line bg-surface'
			]}
		>
			Loading pull requests…
		</p>
	{:else if prs === null}
		<p
			class={[
				'px-4 py-3.5 text-[12.5px] text-muted',
				!compact && 'rounded-xl border border-line bg-surface'
			]}
		>
			Couldn't list pull requests. They need
			<a
				class="text-accent hover:underline"
				href="https://cli.github.com"
				target="_blank"
				rel="noopener noreferrer">gh</a
			>, signed in with <code class="font-mono text-fg">gh auth login</code>, and a repository on
			GitHub.
		</p>
	{:else if prs.length === 0}
		<p
			class={[
				'px-4 py-6 text-center text-[12.5px] text-muted',
				!compact && 'rounded-xl border border-line bg-surface'
			]}
		>
			No open pull requests
		</p>
	{:else}
		<!-- not overflow-hidden, that would keep the filter from sticking -->
		<div
			class={compact ? 'flex min-h-0 flex-1 flex-col' : 'rounded-xl border border-line bg-surface'}
		>
			<!-- stays under the page's header while the list scrolls. Narrow, the views go under
			     the filter -->
			<div
				class={compact
					? 'flex flex-col gap-2 border-b border-line px-3 pb-3'
					: 'sticky top-12 z-10 flex items-center gap-2 rounded-t-xl border-b border-line bg-surface p-2'}
			>
				<!-- the filter keeps focus, arrows move the active row -->
				<input
					bind:value={query}
					oninput={() => (active = 0)}
					{onkeydown}
					onfocus={() => (filtering = true)}
					onblur={() => (filtering = false)}
					{@attach (el) => {
						// beside a pull request it's there to use, not to take the keys from the page
						if (!compact) el.focus();
					}}
					role="combobox"
					aria-label="Filter pull requests"
					aria-expanded="true"
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
					placeholder={compact
						? 'Filter pull requests'
						: 'Filter by title, number, author or branch'}
					spellcheck="false"
					autocomplete="off"
					class={[
						'h-7 min-w-0 text-[12.5px] outline-none placeholder:text-faint',
						compact
							? 'w-full rounded-md border border-line bg-surface px-2 focus:border-muted'
							: 'flex-1 bg-transparent px-1.5'
					]}
				/>
				<!-- the filter keeps focus, arrows and enter still work after picking a view. As
				     wide as its views, under the filter too -->
				<div class="flex shrink-0">
					<SegmentedControl
						options={VIEWS}
						value={view}
						onchange={choose}
						label="Pull requests"
						size={compact ? 'sm' : 'md'}
						text={compact ? 'sm' : 'md'}
						keepFocus
					>
						{#snippet after(option)}
							<span class="text-faint tabular-nums">{counts[option.value]}</span>
						{/snippet}
					</SegmentedControl>
				</div>
			</div>
			<div
				bind:this={list}
				id={listId}
				class={['p-1', compact && 'min-h-0 flex-1 overflow-y-auto pb-4']}
				role="listbox"
				aria-label="Pull requests"
			>
				{#each shown as pr, i (pr.number)}
					<a
						href={href(pr.number)}
						id="{listId}-{i}"
						role="option"
						aria-selected={i === active}
						aria-current={pr.number === current ? 'page' : undefined}
						tabindex="-1"
						data-active={i === active || undefined}
						class={[
							'flex items-start gap-3',
							// narrow, the text lines up with the filter's edge
							compact ? 'rounded-md px-2 py-1.5 hover:bg-subtle' : 'rounded-lg px-3 py-2',
							((marking && i === active) || (!filtering && pr.number === current)) && 'bg-subtle'
						]}
						onpointermove={() => (active = i)}
					>
						<span class="min-w-0 flex-1">
							<span class="flex items-center gap-1.5">
								<span class="truncate text-[12.5px] font-medium">{pr.title}</span>
								<span class="shrink-0 text-[12px] text-faint">#{pr.number}</span>
								{#if pr.isDraft}
									<span
										class="shrink-0 rounded-[4px] border border-line px-1 text-[10px] font-medium text-muted"
										>draft</span
									>
								{:else if pr.reviewDecision === 'APPROVED' || pr.reviewDecision === 'CHANGES_REQUESTED'}
									{@const [label, colors] = PILLS[pr.reviewDecision]}
									<span class="shrink-0 rounded-[4px] border px-1 text-[10px] font-medium {colors}"
										>{label}</span
									>
								{/if}
							</span>
							<span class="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-faint">
								{#if compact && pr.requested}
									<span class="size-1.5 shrink-0 rounded-full bg-accent" title="Your review"></span>
								{/if}
								{pr.mine ? 'you' : pr.author} ·
								{#if compact}
									{timeAgo(pr.updatedAt)}
								{:else}
									<span class="font-mono">{pr.baseRefName} ← {pr.headRefName}</span>
								{/if}
							</span>
						</span>
						<!-- narrow, the row keeps to its title and who's waiting on whom -->
						{#if !compact && pr.requested}
							<span class="mt-0.5 flex shrink-0 items-center gap-1.5 text-[11px] text-accent">
								<span class="size-1.5 rounded-full bg-accent"></span>your review
							</span>
						{:else if !compact && pr.reviewed}
							<span class="mt-0.5 shrink-0 text-[11px] text-faint">{REVIEWED[pr.reviewed]}</span>
						{/if}
						{#if !compact}
							<span
								class="mt-0.5 shrink-0 text-[11px] text-faint tabular-nums"
								title="Updated {new Date(pr.updatedAt).toLocaleString()}"
								>{timeAgo(pr.updatedAt)}</span
							>
						{/if}
					</a>
				{:else}
					<p class="px-3 py-6 text-center text-[12px] text-muted">
						{query.trim() ? 'No pull requests match' : picked.empty}
					</p>
				{/each}
			</div>
		</div>
	{/if}
</div>
