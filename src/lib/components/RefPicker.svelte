<script lang="ts">
	import { tick } from 'svelte';
	import { listNav } from '$lib/list-nav';
	import { sameSha, timeAgo, type Branch, type Commit } from '$lib/refs';
	import type { PrSummary } from '$lib/pr/types';
	import Popover from './Popover.svelte';

	type Tab = 'branches' | 'tags' | 'commits' | 'prs';

	interface Props {
		label: string;
		/** selected revision, empty for the default */
		value: string;
		/** what an empty value means, shown on the button */
		fallback: string;
		branches: Branch[];
		commits: Commit[];
		/** a second group of commits under the first, headed by `moreLabel` */
		more?: Commit[];
		moreLabel?: string;
		/** pull requests, their number is the value */
		prs?: PrSummary[];
		/** limit which tabs are offered */
		only?: Tab[];
		/** placeholder for the filter input */
		placeholder?: string;
		onselect: (value: string) => void;
	}

	let {
		label,
		value,
		fallback,
		branches,
		commits,
		more = [],
		moreLabel = '',
		prs = [],
		only,
		placeholder = 'Filter, or type any revision',
		onselect
	}: Props = $props();

	type Item = {
		value: string;
		title: string;
		detail: string;
		date: string;
		kind: Branch['kind'] | 'commit' | 'pr';
		current?: boolean;
		refs?: string[];
		/** heading shown above the first item of a group */
		group?: string;
	};

	let button: HTMLButtonElement;
	let list = $state<HTMLElement>();
	const id = $props.id();
	const listId = `${id}-list`;
	let open = $state(false);
	let query = $state('');
	let tab = $state<Tab>('branches');
	let active = $state(0);

	const tags = $derived(branches.filter((b) => b.kind === 'tag'));
	const tabs = $derived<Tab[]>(
		(only ?? ['branches', 'commits', 'tags']).filter((t) => t !== 'tags' || tags.length > 0)
	);

	const items = $derived.by((): Item[] => {
		const commit = (c: Commit, group?: string): Item => ({
			value: c.sha,
			title: c.subject,
			detail: `${c.sha} · ${c.author}`,
			date: c.date,
			kind: 'commit',
			refs: c.refs,
			group
		});
		const all: Item[] =
			tab === 'prs'
				? prs.map((p) => ({
						value: String(p.number),
						title: p.title,
						detail: `#${p.number} · ${p.author} · ${p.baseRefName} ← ${p.headRefName}${p.isDraft ? ' · draft' : ''}`,
						date: p.updatedAt,
						kind: 'pr'
					}))
				: tab === 'commits'
					? [
							...commits.map((c) => commit(c)),
							...more.map((c, i) => commit(c, i === 0 ? moreLabel : undefined))
						]
					: branches
							.filter((b) => (tab === 'tags' ? b.kind === 'tag' : b.kind !== 'tag'))
							.map((b) => ({
								value: b.name,
								title: b.name,
								detail: `${b.sha} · ${b.subject}`,
								date: b.date,
								kind: b.kind,
								current: b.current
							}));

		const q = query.trim().toLowerCase();
		if (!q) return all;
		const found = all.filter((item) =>
			`${item.title} ${item.detail} ${item.value}`.toLowerCase().includes(q)
		);
		// the heading moves to whichever of its items is still showing
		const firstMore = found.find((item) => more.some((c) => c.sha === item.value));
		return found.map((item) => ({ ...item, group: item === firstMore ? moreLabel : undefined }));
	});

	const display = $derived.by(() => {
		if (!value) return { title: fallback, sha: '' };
		const pr = prs.find((p) => String(p.number) === value);
		if (pr) return { title: pr.title, sha: `#${pr.number}` };
		const commit = [...commits, ...more].find((c) => sameSha(c.sha, value));
		if (commit) return { title: commit.subject, sha: commit.sha };
		return { title: value, sha: '' };
	});

	// runs before the browser toggles the popover, so `open` is still the old state
	function toggle() {
		if (!open) {
			query = '';
			active = 0;
			// start on the tab that holds the current selection
			const guess: Tab = prs.some((p) => String(p.number) === value)
				? 'prs'
				: [...commits, ...more].some((c) => sameSha(c.sha, value))
					? 'commits'
					: tags.some((t) => t.name === value)
						? 'tags'
						: 'branches';
			tab = tabs.includes(guess) ? guess : tabs[0];
		}
	}

	/** Closes the list, focus goes back to the button instead of getting lost. */
	async function close() {
		open = false;
		await tick();
		button?.focus();
	}

	function choose(next: string) {
		close();
		if (next !== value) onselect(next);
	}

	function onkeydown(event: KeyboardEvent) {
		listNav(event, {
			active,
			count: items.length,
			list,
			onmove: (i) => (active = i),
			onenter: () => {
				// with nothing matching, whatever was typed is used as a revision
				const item = items[active];
				if (item) choose(item.value);
				else if (query.trim()) choose(query.trim());
			}
		});
		if (event.key === 'Escape') {
			// the popover would close itself, but focus has to go back to the button,
			// and inside a dialog Escape would close the dialog too
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	}

	// tabbing out of the list closes it, back to the button doesn't; the browser
	// closes it on clicks outside
	function onfocusout(event: FocusEvent) {
		const next = event.relatedTarget as Node | null;
		if (!(event.currentTarget as HTMLElement).contains(next) && next !== button) open = false;
	}
</script>

<!-- clicking a heading or the padding keeps focus in the filter, the list stays open -->
<Popover
	bind:open
	class="w-[28rem] overflow-hidden rounded-xl border border-line bg-surface shadow-[0_8px_30px_-12px_rgb(0_0_0/0.25)]"
	role="presentation"
	onpointerdown={(e) => {
		if (!(e.target as HTMLElement).closest('button, input')) e.preventDefault();
	}}
	{onfocusout}
>
	{#snippet trigger(props)}
		<button
			{...props}
			bind:this={button}
			class={[
				'flex h-8 w-56 items-center gap-2 rounded-lg border bg-surface px-2.5 text-left hover:border-muted',
				open ? 'border-muted' : 'border-line'
			]}
			aria-haspopup="listbox"
			onclick={toggle}
		>
			<span class="shrink-0 text-[11px] text-faint">{label}</span>
			{#if display.sha}
				<span class="shrink-0 font-mono text-[11.5px] text-accent">{display.sha}</span>
			{/if}
			<span class={['min-w-0 flex-1 truncate text-[12px]', !display.sha && 'font-mono']}>
				{display.title}
			</span>
			<svg
				viewBox="0 0 16 16"
				class="size-3 shrink-0 text-faint"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="m4 6 4 4 4-4" /></svg
			>
		</button>
	{/snippet}

	<div class="flex items-center gap-2 border-b border-line p-2">
		<input
			bind:value={query}
			oninput={() => (active = 0)}
			{onkeydown}
			{@attach (el) => el.focus()}
			role="combobox"
			aria-label={label}
			aria-expanded="true"
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
			{placeholder}
			spellcheck="false"
			autocomplete="off"
			class="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-[12.5px] outline-none placeholder:text-faint"
		/>
		<div class={['flex shrink-0 rounded-lg border border-line p-0.5', tabs.length < 2 && 'hidden']}>
			{#each tabs as t (t)}
				<button
					type="button"
					class={[
						'rounded-md px-2 py-0.5 text-[11.5px] capitalize',
						t === tab ? 'bg-subtle text-fg' : 'text-muted hover:text-fg'
					]}
					onclick={() => {
						tab = t;
						active = 0;
					}}>{t}</button
				>
			{/each}
		</div>
	</div>

	<div
		bind:this={list}
		id={listId}
		class="max-h-[22rem] overflow-y-auto p-1"
		role="listbox"
		aria-label={label}
	>
		{#each items as item, i (item.kind + item.value)}
			{@const selected = item.kind === 'commit' ? sameSha(item.value, value) : item.value === value}
			{#if item.group}
				<p
					role="presentation"
					class="mt-1 border-t border-line px-2.5 pt-2.5 pb-1 text-[10.5px] font-medium tracking-wide text-faint uppercase"
				>
					{item.group}
				</p>
			{/if}
			<!-- the filter keeps focus, arrows move the active option -->
			<button
				type="button"
				id="{listId}-{i}"
				role="option"
				aria-selected={selected}
				tabindex="-1"
				data-active={i === active || undefined}
				class={[
					'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left',
					i === active && 'bg-subtle'
				]}
				onpointermove={() => (active = i)}
				onclick={() => choose(item.value)}
			>
				<span class="mt-0.5 shrink-0 text-faint">
					{#if item.kind === 'commit'}
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							><circle cx="8" cy="8" r="2.5" /><path d="M1 8h4.5M10.5 8H15" /></svg
						>
					{:else if item.kind === 'pr'}
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							><circle cx="4" cy="3.5" r="1.5" /><circle cx="4" cy="12.5" r="1.5" /><circle
								cx="12"
								cy="12.5"
								r="1.5"
							/><path d="M4 5v6M12 11V6.5c0-1.5-1-2.5-2.5-2.5H7m1.5-1.5L7 4l1.5 1.5" /></svg
						>
					{:else if item.kind === 'tag'}
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linejoin="round"
							><path d="M2 2h5.5L14 8.5 8.5 14 2 7.5z" /><circle
								cx="5"
								cy="5"
								r="0.75"
								fill="currentColor"
							/></svg
						>
					{:else}
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle
								cx="11.5"
								cy="5"
								r="1.5"
							/><path d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5" /></svg
						>
					{/if}
				</span>
				<span class="min-w-0 flex-1">
					<span class="flex items-center gap-1.5">
						<span
							class={[
								'truncate text-[12.5px]',
								item.kind !== 'commit' && item.kind !== 'pr' && 'font-mono',
								item.kind === 'remote' && 'text-muted'
							]}>{item.title}</span
						>
						{#if item.current}
							<span
								class="shrink-0 rounded-[4px] bg-accent/12 px-1 text-[10px] font-medium text-accent"
								>HEAD</span
							>
						{/if}
						{#each item.refs ?? [] as ref (ref)}
							<span
								class="shrink-0 rounded-[4px] border border-line px-1 font-mono text-[10px] text-muted"
								>{ref}</span
							>
						{/each}
					</span>
					<span class="block truncate text-[11px] text-faint">{item.detail}</span>
				</span>
				<span class="mt-0.5 flex shrink-0 items-center gap-2 text-[11px] text-faint tabular-nums">
					{#if item.date}{timeAgo(item.date)}{/if}
					{#if selected}
						<svg
							viewBox="0 0 16 16"
							class="size-3.5 text-accent"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg
						>
					{/if}
				</span>
			</button>
		{:else}
			<p class="px-3 py-6 text-center text-[12px] text-muted">
				{#if query.trim()}
					Press <kbd class="rounded border border-line px-1 font-mono text-[11px]">↵</kbd> to use
					<span class="font-mono text-fg">{query.trim()}</span>
				{:else}
					Nothing here
				{/if}
			</p>
		{/each}
	</div>
</Popover>
