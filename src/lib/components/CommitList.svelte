<script lang="ts">
	import { timeAgo, type Commit } from '$lib/refs';

	interface Props {
		/** oldest first */
		commits: Commit[];
		/** selected span, null when the whole branch is shown */
		first: string | null;
		last: string | null;
		/** the branch they're on, shown in the heading */
		name?: string;
		/** whether "Show all" can go back to the whole branch */
		canShowAll?: boolean;
		/** fill a resizable panel instead of capping its own height */
		fill?: boolean;
		onselect: (first: string | null, last: string | null) => void;
	}

	let { commits, first, last, name, canShowAll = true, fill = false, onselect }: Props = $props();
	let list = $state<HTMLElement>();
	let query = $state('');
	const searchId = $props.id();
	const filter = $derived(query.trim().toLowerCase());
	// Keep the original index: filtering must not renumber history or alter a selected span.
	const matching = $derived(
		commits
			.map((commit, index) => ({ commit, index }))
			.filter(
				({ commit }) => !filter || `${commit.subject} ${commit.sha}`.toLowerCase().includes(filter)
			)
	);

	// the commit a shift-click extends from
	let anchor = $state<string | null>(null);

	const firstIndex = $derived(first ? commits.findIndex((c) => c.sha === first) : -1);
	const lastIndex = $derived(last ? commits.findIndex((c) => c.sha === last) : -1);
	const narrowed = $derived(firstIndex >= 0);

	$effect(() => {
		void matching;
		const selected = last || first;
		const scroller = list;
		const row =
			selected && scroller?.querySelector<HTMLElement>(`[data-commit="${CSS.escape(selected)}"]`);
		if (!scroller || !row) return;

		// Remember whether the reviewer left the selected row in view. Resizing should
		// keep a visible selection readable, without undoing a manual scroll elsewhere.
		let keepVisible = true;
		const trackScroll = () => {
			const bounds = scroller.getBoundingClientRect();
			const item = row.getBoundingClientRect();
			keepVisible = item.top >= bounds.top - 1 && item.bottom <= bounds.bottom + 1;
		};
		const revealSelected = () => {
			if (!scroller.clientHeight || !scroller.clientWidth) return;
			const bounds = scroller.getBoundingClientRect();
			const item = row.getBoundingClientRect();
			// Change only this list's scroll position; never scroll the diff or page.
			if (item.top < bounds.top || item.height > bounds.height) {
				scroller.scrollTop += item.top - bounds.top;
			} else if (item.bottom > bounds.bottom) {
				scroller.scrollTop += item.bottom - bounds.bottom;
			}
			trackScroll();
		};

		revealSelected();
		const resize = new ResizeObserver(() => {
			if (keepVisible) revealSelected();
		});
		resize.observe(scroller);
		resize.observe(row);
		scroller.addEventListener('scroll', trackScroll, { passive: true });
		return () => {
			resize.disconnect();
			scroller.removeEventListener('scroll', trackScroll);
		};
	});

	function click(event: MouseEvent, sha: string) {
		// the list outlives navigations, a commit clicked before stepping or switching
		// branch mustn't start the span, only one at an end of what's selected now
		const current = anchor && (anchor === first || anchor === last) ? anchor : null;
		const from = current ?? first;
		if (event.shiftKey && from) {
			onselect(from, sha);
			return;
		}
		anchor = sha;
		if (first === sha && last === sha && canShowAll) {
			anchor = null;
			onselect(null, null);
		} else {
			onselect(sha, sha);
		}
	}
</script>

<!-- padded inside the scroll area, so the scrollbar sits against the edge -->
<div class={['py-2', fill ? 'flex min-h-0 flex-1 flex-col' : 'border-b border-line']}>
	<div class="flex items-center justify-between px-4 pt-1 pb-1.5">
		<p class="text-[10.5px] font-medium tracking-wide text-faint uppercase">
			Commits · {commits.length}
			{#if name}<span class="normal-case">on <span class="font-mono">{name}</span></span>{/if}
		</p>
		{#if narrowed && canShowAll}
			<button
				type="button"
				class="text-[11px] text-accent hover:underline"
				onclick={() => {
					anchor = null;
					onselect(null, null);
				}}
			>
				Show all
			</button>
		{/if}
	</div>

	<div class="shrink-0 px-3 pt-1 pb-2">
		<label for={searchId} class="sr-only">Find a commit by subject or SHA</label>
		<div
			class="flex h-8 items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 text-faint focus-within:border-muted"
		>
			<svg
				viewBox="0 0 16 16"
				class="size-3 shrink-0"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				aria-hidden="true"><circle cx="7" cy="7" r="4" /><path d="m10 10 3 3" /></svg
			>
			<input
				id={searchId}
				type="text"
				inputmode="search"
				autocomplete="off"
				spellcheck="false"
				bind:value={query}
				placeholder="Find commit…"
				aria-controls="{searchId}-results"
				onkeydown={(event) => {
					if (event.key === 'Escape' && !event.isComposing && query) {
						query = '';
						event.preventDefault();
						event.stopPropagation();
					}
				}}
				class="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-faint"
			/>
			{#if query}
				<button
					type="button"
					aria-label="Clear commit search"
					onclick={() => {
						query = '';
						document.getElementById(searchId)?.focus();
					}}
					class="grid size-5 shrink-0 place-items-center rounded text-faint hover:bg-subtle hover:text-fg"
					><svg
						viewBox="0 0 16 16"
						class="size-3"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg
					></button
				>
			{/if}
		</div>
		{#if filter}
			<p class="px-1 pt-1.5 text-[10.5px] text-faint" role="status">
				Showing {matching.length} of {commits.length} commits
			</p>
		{/if}
	</div>

	<!-- not selectable, shift-click extends the span rather than a text selection -->
	<div
		id="{searchId}-results"
		bind:this={list}
		class={['flex flex-col overflow-y-auto px-2 select-none', fill ? 'min-h-0 flex-1' : 'max-h-64']}
	>
		{#each matching as { commit, index } (commit.sha)}
			{@const selected = narrowed && index >= firstIndex && index <= lastIndex}
			<button
				type="button"
				class={[
					'relative flex shrink-0 gap-2 rounded-lg px-2 py-1 text-left text-[12px]',
					selected ? 'items-start bg-accent/8' : 'items-center hover:bg-subtle',
					narrowed && !selected && 'opacity-55'
				]}
				aria-current={selected || undefined}
				data-commit={commit.sha}
				title="{commit.subject}&#10;{commit.author} · {commit.sha}"
				onclick={(e) => click(e, commit.sha)}
			>
				{#if selected}
					<span class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"></span>
				{/if}
				<span class="w-4 shrink-0 text-right text-[10.5px] text-faint tabular-nums"
					>{index + 1}</span
				>
				<span class="min-w-0 flex-1">
					<span class={selected ? 'line-clamp-2 leading-snug' : 'block truncate'}
						>{commit.subject}</span
					>
					{#if selected}
						<span class="mt-0.5 block font-mono text-[10.5px] text-faint"
							>{commit.sha.slice(0, 7)}</span
						>
					{/if}
				</span>
				<span class="shrink-0 text-[10.5px] text-faint tabular-nums">{timeAgo(commit.date)}</span>
			</button>
		{:else}
			<div class="px-2 py-3 text-[12px] text-muted">
				{#if filter}
					<p class="break-words">No commits match “{query}”.</p>
					<p class="mt-1 text-[11px] text-faint">Try a commit subject or short SHA.</p>
				{:else}
					<p>No commits on this branch yet</p>
				{/if}
			</div>
		{/each}
	</div>

	{#if commits.length > 1}
		<p class="px-4 pt-1.5 text-[10.5px] text-faint">
			Click to see one commit, shift-click to select a span
		</p>
	{/if}
</div>
