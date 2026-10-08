<script lang="ts">
	import type { DiffFile } from '$lib/diff/types';
	import { jumpToThread, where } from '$lib/pr/jump';
	import type { ReviewThread } from '$lib/pr/types';
	import Popover from '../Popover.svelte';

	interface Props {
		threads: ReviewThread[];
		files: DiffFile[];
	}

	let { threads, files }: Props = $props();

	let open = $state(false);

	const unresolved = $derived(threads.filter((t) => !t.isResolved).length);

	function go(thread: ReviewThread) {
		open = false;
		jumpToThread(thread, files);
	}
</script>

<Popover
	bind:open
	align="end"
	class="max-h-[60vh] w-[26rem] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.25)]"
>
	{#snippet trigger(props)}
		<button
			{...props}
			class={[
				'ml-3 flex h-7 shrink-0 items-center gap-1.5 rounded-lg border bg-surface px-2.5 text-[12px] text-muted hover:border-muted hover:text-fg',
				open ? 'border-muted' : 'border-line'
			]}
			title="Go to a review comment"
		>
			Comments
			<span class="text-faint tabular-nums">{unresolved}/{threads.length}</span>
		</button>
	{/snippet}
	{#each threads as thread (thread.id)}
		{@const first = thread.comments[0]}
		<button
			type="button"
			class={[
				'flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-subtle',
				thread.isResolved && 'opacity-60'
			]}
			onclick={() => go(thread)}
		>
			<span class="flex items-center gap-1.5 text-[11px] text-faint">
				<span class="truncate font-mono" title={thread.path}>{where(thread)}</span>
				{#if thread.comments.some((c) => c.pending)}<span
						class="size-1.5 shrink-0 rounded-full bg-accent"
						title="Pending in your review"
					></span>{/if}
				{#if thread.isOutdated}<span>· outdated</span>{/if}
				{#if thread.isResolved}<span>· resolved</span>{/if}
				<span class="ml-auto shrink-0 tabular-nums">{thread.comments.length}</span>
			</span>
			{#if first}
				<span class="truncate text-[12px]"
					><span class="font-medium">{first.author}</span>
					<span class="text-muted">{first.body}</span></span
				>
			{/if}
		</button>
	{/each}
</Popover>
