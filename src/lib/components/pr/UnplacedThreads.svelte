<script lang="ts">
	import type { ReviewThread, Replying } from '$lib/pr/types';
	import HunkPeek from './HunkPeek.svelte';
	import ResolveButton from './ResolveButton.svelte';
	import ReviewComments from './ReviewComments.svelte';

	interface Props {
		/** a file's review threads that aren't on any of its lines in the diff */
		threads: ReviewThread[];
		reply?: Replying;
	}

	let { threads, reply }: Props = $props();

	const where = (thread: ReviewThread) =>
		thread.file
			? 'On the whole file'
			: thread.isOutdated
				? 'Outdated, the code changed since'
				: 'On lines this diff doesn’t show';
</script>

<div class="flex flex-col gap-3 border-t border-line bg-subtle/50 px-4 py-3">
	{#each threads as thread (thread.id)}
		<div class="overflow-hidden rounded-2xl border border-line bg-surface">
			<p class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] text-faint">
				<span class="size-1.5 rounded-full bg-ink-soft"></span>
				{where(thread)}
				{#if thread.isResolved}<span>· resolved</span>{/if}
				<span class="ml-auto"><ResolveButton {thread} /></span>
			</p>
			<HunkPeek {thread} />
			<div class="p-3">
				<ReviewComments {thread} {reply} />
			</div>
		</div>
	{/each}
</div>
