<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { errorText } from '$lib/errors';
	import type { Scan } from '$lib/repos';
	import { getRepos, pickRepo, rescanRepos } from '$lib/repos.remote';
	import { timeAgo } from '$lib/refs';

	interface Props {
		/** the open repo, marked in the list */
		current: string;
		onpick: (repo: string) => void;
		/** list height, the popover needs less than the landing page */
		height?: string;
	}

	let { current, onpick, height = 'max-h-80' }: Props = $props();

	let scan = $state<Scan | null>(null);
	let problem = $state('');
	// true from the start so the first paint says it is looking, not that nothing was found
	let scanning = $state(true);
	let picking = $state(false);
	let query = $state('');
	let active = $state(0);
	let list = $state<HTMLElement>();
	const listId = $props.id();

	async function refresh(force = false) {
		scanning = true;
		problem = '';
		try {
			scan = await (force ? rescanRepos() : getRepos());
		} catch (e) {
			problem = errorText(e);
		} finally {
			scanning = false;
		}
	}

	onMount(() => {
		refresh();
	});

	const short = (path: string) =>
		scan && path.startsWith(scan.home + '/') ? '~' + path.slice(scan.home.length) : path;

	const repos = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const all = scan?.repos ?? [];
		return q ? all.filter((r) => `${r.name} ${short(r.path)}`.toLowerCase().includes(q)) : all;
	});

	async function move(delta: number) {
		if (!repos.length) return;
		active = (active + delta + repos.length) % repos.length;
		await tick();
		list?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			move(1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			move(-1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const typed = query.trim();
			// a typed path opens even when the scan didn't find it
			if (repos[active]) onpick(repos[active].path);
			else if (typed.startsWith('/') || typed.startsWith('~')) {
				onpick(scan && typed.startsWith('~') ? scan.home + typed.slice(1) : typed);
			}
		}
	}

	async function choose() {
		picking = true;
		problem = '';
		try {
			const repo = await pickRepo(current);
			if (repo) onpick(repo);
		} catch (e) {
			problem = errorText(e);
		} finally {
			picking = false;
		}
	}
</script>

<div class="flex flex-col">
	<div class="flex items-center gap-2 border-b border-line p-2">
		<svg
			viewBox="0 0 16 16"
			class="ml-1 size-3.5 shrink-0 text-faint"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg
		>
		<input
			bind:value={query}
			oninput={() => (active = 0)}
			{onkeydown}
			{@attach (el) => el.focus()}
			role="combobox"
			aria-label="Repository"
			aria-expanded="true"
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={repos[active] ? `${listId}-${active}` : undefined}
			placeholder="Filter repositories, or type a path"
			spellcheck="false"
			autocomplete="off"
			class="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
		/>
	</div>

	<div
		bind:this={list}
		id={listId}
		class={['overflow-y-auto p-1', height]}
		role="listbox"
		aria-label="Repositories"
	>
		{#if !scan && scanning}
			<p class="flex items-center justify-center gap-2 px-3 py-8 text-[12px] text-muted">
				<span
					class="size-3 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent"
				></span>
				Looking for git repositories…
			</p>
		{:else}
			{#each repos as repo, i (repo.path)}
				{@const selected = repo.path === current}
				<button
					type="button"
					id="{listId}-{i}"
					role="option"
					aria-selected={selected}
					tabindex="-1"
					data-active={i === active || undefined}
					class={[
						'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left',
						i === active && 'bg-subtle'
					]}
					title={repo.remote ?? repo.path}
					onpointermove={() => (active = i)}
					onclick={() => onpick(repo.path)}
				>
					<svg
						viewBox="0 0 16 16"
						class={['size-3.5 shrink-0', selected ? 'text-accent' : 'text-faint']}
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linejoin="round"
						><path
							d="M2 4.5c0-.6.4-1 1-1h3.3l1.4 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z"
						/></svg
					>
					<span class="min-w-0 flex-1">
						<span class="flex items-center gap-1.5">
							<span class="truncate text-[12.5px] font-medium">{repo.name}</span>
							{#if repo.branch}
								<span
									class="shrink-0 truncate rounded-[4px] border border-line px-1 font-mono text-[10px] text-muted"
									>{repo.branch}</span
								>
							{/if}
						</span>
						<span class="block truncate font-mono text-[10.5px] text-faint">{short(repo.path)}</span
						>
					</span>
					<span class="shrink-0 text-[11px] text-faint tabular-nums">
						{repo.active ? timeAgo(repo.active) : 'no commits'}
					</span>
					{#if selected}
						<svg
							viewBox="0 0 16 16"
							class="size-3.5 shrink-0 text-accent"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg
						>
					{/if}
				</button>
			{:else}
				<p class="px-3 py-6 text-center text-[12px] text-muted">
					{#if query.trim().startsWith('/') || query.trim().startsWith('~')}
						Press <kbd class="rounded border border-line px-1 font-mono text-[11px]">↵</kbd> to open
						<span class="font-mono text-fg">{query.trim()}</span>
					{:else if query.trim()}
						No repository matches
					{:else}
						No git repositories found
					{/if}
				</p>
			{/each}
		{/if}
	</div>

	{#if problem}
		<p class="flex items-start gap-1.5 px-3 pb-2 text-[12px] text-del">
			<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-del"></span>{problem}
		</p>
	{/if}

	<div class="flex items-center gap-2 border-t border-line px-3 py-2 text-[11px] text-faint">
		{#if scan}
			<span class="min-w-0 truncate" title="Scanned {scan.roots.map(short).join(', ')}">
				{scan.repos.length} found in {scan.roots.map(short).join(', ')}{scan.truncated
					? ' (stopped early)'
					: ''}
			</span>
			<button
				type="button"
				class="shrink-0 text-muted hover:text-accent disabled:opacity-50"
				disabled={scanning}
				onclick={() => refresh(true)}>{scanning ? 'Scanning…' : 'Rescan'}</button
			>
		{/if}
		<button
			type="button"
			class="ml-auto flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-muted hover:bg-subtle hover:text-fg disabled:opacity-60"
			disabled={picking}
			title="Open your system's folder dialog"
			onclick={choose}
		>
			{#if picking}
				<span
					class="size-3 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent"
				></span>
				Waiting for the dialog…
			{:else}
				Choose folder…
			{/if}
		</button>
	</div>
</div>
