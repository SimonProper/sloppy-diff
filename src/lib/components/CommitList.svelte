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

	// the commit a shift-click extends from
	let anchor = $state<string | null>(null);

	const firstIndex = $derived(first ? commits.findIndex((c) => c.sha === first) : -1);
	const lastIndex = $derived(last ? commits.findIndex((c) => c.sha === last) : -1);
	const narrowed = $derived(firstIndex >= 0);

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

	<!-- not selectable, shift-click extends the span rather than a text selection -->
	<div
		class={['flex flex-col overflow-y-auto px-2 select-none', fill ? 'min-h-0 flex-1' : 'max-h-64']}
	>
		{#each commits as commit, i (commit.sha)}
			{@const selected = narrowed && i >= firstIndex && i <= lastIndex}
			<button
				type="button"
				class={[
					'relative flex items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px]',
					selected ? 'bg-accent/8' : 'hover:bg-subtle',
					narrowed && !selected && 'opacity-55'
				]}
				title="{commit.subject}&#10;{commit.author} · {commit.sha}"
				onclick={(e) => click(e, commit.sha)}
			>
				{#if selected}
					<span class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"></span>
				{/if}
				<span class="w-4 shrink-0 text-right text-[10.5px] text-faint tabular-nums">{i + 1}</span>
				<span class="min-w-0 flex-1 truncate">{commit.subject}</span>
				<span class="shrink-0 text-[10.5px] text-faint tabular-nums">{timeAgo(commit.date)}</span>
			</button>
		{:else}
			<p class="px-2 py-2 text-[12px] text-faint">No commits on this branch yet</p>
		{/each}
	</div>

	{#if commits.length > 1}
		<p class="px-4 pt-1.5 text-[10.5px] text-faint">
			Click to see one commit, shift-click to select a span
		</p>
	{/if}
</div>
