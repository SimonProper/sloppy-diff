<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import type { GuideListing } from '$lib/guide/types';
	import { timeAgo } from '$lib/refs';

	interface Props {
		guides: GuideListing[];
		/** the open repo, other repos get their name shown */
		repo: string;
		onnavigate?: () => void;
	}

	let { guides, repo, onnavigate }: Props = $props();

	const repoName = (path: string) => path.split('/').filter(Boolean).pop() ?? path;
	const key = (g: GuideListing) => `${g.repo}\0${g.start}\0${g.stop}`;
	const href = (g: GuideListing) =>
		`?${new URLSearchParams({ repo: g.repo, from: g.start, to: g.stop, view: 'guide' })}`;

	// deleting takes a second click on the same guide
	let confirming = $state<string | null>(null);
	let deleting = $state<string | null>(null);
	let failure = $state('');

	async function remove(g: GuideListing) {
		if (confirming !== key(g)) {
			confirming = key(g);
			return;
		}
		deleting = key(g);
		failure = '';
		const params = new URLSearchParams({ repo: g.repo, start: g.start, stop: g.stop });
		const res = await fetch(`/api/guides/saved?${params}`, { method: 'DELETE' });
		if (res.ok) await invalidateAll();
		else failure = (await res.json()).message;
		deleting = confirming = null;
	}
</script>

<div class="flex flex-col" role="list">
	{#each guides as g (key(g))}
		{@const armed = confirming === key(g)}
		<!-- leaving disarms, Safari doesn't focus a clicked button so blur alone can't -->
		<div
			role="listitem"
			class={[
				'group flex items-center rounded-lg hover:bg-subtle',
				deleting === key(g) && 'opacity-50'
			]}
			onmouseleave={() => armed && (confirming = null)}
		>
			<a
				href={href(g)}
				onclick={onnavigate}
				title="{g.title}&#10;Created {new Date(g.createdAt).toLocaleString()}"
				class="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pr-2 pl-2"
			>
				<svg
					viewBox="0 0 16 16"
					class="size-3.5 shrink-0 text-accent"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path
						d="M8 2.5 9.3 6.2 13 7.5 9.3 8.8 8 12.5 6.7 8.8 3 7.5l3.7-1.3zM12.5 11.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"
					/></svg
				>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-[12.5px]">{g.title}</span>
					<span class="block truncate text-[11px] text-faint">
						{#if g.repo !== repo}<span class="text-muted">{repoName(g.repo)}</span> ·{/if}
						<span class="font-mono">{g.start.slice(0, 7)}..{g.stop.slice(0, 7)}</span>
						· {g.sections} sections
					</span>
				</span>
			</a>
			<!-- the age and the delete button share one spot, hovering or focusing the row swaps them -->
			<div class="mr-1 grid shrink-0 items-center justify-items-end">
				<span
					class={[
						'col-start-1 row-start-1 pr-1 text-[11px] text-faint tabular-nums',
						armed ? 'invisible' : 'group-focus-within:invisible group-hover:invisible'
					]}>{timeAgo(g.createdAt)}</span
				>
				<button
					type="button"
					class={[
						'col-start-1 row-start-1 flex h-6 items-center justify-center rounded-md text-[11px] font-medium',
						armed
							? 'bg-del px-2 text-white'
							: 'invisible w-6 text-faint group-focus-within:visible group-hover:visible hover:text-del'
					]}
					title={armed ? 'Click again to delete' : 'Delete guide'}
					aria-label={armed ? `Confirm deleting ${g.title}` : `Delete ${g.title}`}
					disabled={deleting !== null}
					onclick={() => remove(g)}
					onblur={() => armed && (confirming = null)}
				>
					{#if armed}
						Delete
					{:else}
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path
								d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.8 7v3.5M9.2 7v3.5"
							/></svg
						>
					{/if}
				</button>
			</div>
		</div>
	{/each}
	{#if failure}
		<p class="flex items-center gap-1.5 px-2 pt-1.5 text-[11.5px] text-del">
			<span class="size-1.5 rounded-full bg-del"></span>{failure}
		</p>
	{/if}
</div>
