<script lang="ts">
	import { goto } from '$app/navigation';
	import { listNav } from '$lib/list-nav';
	import { timeAgo } from '$lib/refs';
	import type { PrSummary } from '$lib/pr/types';

	interface Props {
		/** null when gh couldn't list them */
		prs: PrSummary[] | null;
		/** where picking one goes */
		href: (number: number) => string;
	}

	let { prs, href }: Props = $props();

	let query = $state('');
	let active = $state(0);
	let list = $state<HTMLElement>();
	const listId = $props.id();

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return prs ?? [];
		return (prs ?? []).filter((p) =>
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
</script>

<!-- as wide as the diff it opens -->
<div class="flex flex-col p-4">
	<p class="px-1 pb-2 text-[10.5px] font-medium tracking-wide text-faint uppercase">
		Open pull requests
	</p>
	{#if prs === null}
		<p class="rounded-xl border border-line bg-surface px-4 py-3.5 text-[12.5px] text-muted">
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
			class="rounded-xl border border-line bg-surface px-4 py-6 text-center text-[12.5px] text-muted"
		>
			No open pull requests
		</p>
	{:else}
		<div class="overflow-hidden rounded-xl border border-line bg-surface">
			<div class="border-b border-line p-2">
				<!-- the filter keeps focus, arrows move the active row -->
				<input
					bind:value={query}
					oninput={() => (active = 0)}
					{onkeydown}
					{@attach (el) => el.focus()}
					role="combobox"
					aria-label="Filter pull requests"
					aria-expanded="true"
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
					placeholder="Filter by title, number, author or branch"
					spellcheck="false"
					autocomplete="off"
					class="h-7 w-full bg-transparent px-1.5 text-[12.5px] outline-none placeholder:text-faint"
				/>
			</div>
			<div bind:this={list} id={listId} class="p-1" role="listbox" aria-label="Pull requests">
				{#each shown as pr, i (pr.number)}
					<a
						href={href(pr.number)}
						id="{listId}-{i}"
						role="option"
						aria-selected={i === active}
						tabindex="-1"
						data-active={i === active || undefined}
						class={['flex items-start gap-3 rounded-lg px-3 py-2', i === active && 'bg-subtle']}
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
								{/if}
							</span>
							<span class="mt-0.5 block truncate text-[11px] text-faint">
								{pr.author} ·
								<span class="font-mono">{pr.baseRefName} ← {pr.headRefName}</span>
							</span>
						</span>
						<span
							class="mt-0.5 shrink-0 text-[11px] text-faint tabular-nums"
							title="Updated {new Date(pr.updatedAt).toLocaleString()}"
							>{timeAgo(pr.updatedAt)}</span
						>
					</a>
				{:else}
					<p class="px-3 py-6 text-center text-[12px] text-muted">No pull requests match</p>
				{/each}
			</div>
		</div>
	{/if}
</div>
