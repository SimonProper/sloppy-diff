<script lang="ts">
	import type { ReviewThread } from '$lib/pr/types';
	import ReviewComments from './ReviewComments.svelte';

	interface Props {
		/** a file's review threads that aren't on any of its lines in the diff */
		threads: ReviewThread[];
		onreply?: (thread: string, body: string) => Promise<unknown>;
	}

	let { threads, onreply }: Props = $props();

	/** the end of the code a thread was started on, where its lines were */
	const excerpt = (thread: ReviewThread) => thread.diffHunk.split('\n').slice(-6);

	const where = (thread: ReviewThread) =>
		thread.file
			? 'On the whole file'
			: thread.isOutdated
				? 'Outdated, the code changed since'
				: 'On lines this diff doesn’t show';
</script>

<div class="flex flex-col gap-3 border-t border-line bg-subtle/50 px-4 py-3">
	{#each threads as thread (thread.id)}
		<div class="overflow-hidden rounded-lg border border-line bg-surface">
			<p class="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] text-faint">
				<span class="size-1.5 rounded-full bg-ink-soft"></span>
				{where(thread)}
				{#if thread.isResolved}<span>· resolved</span>{/if}
			</p>
			{#if thread.diffHunk && !thread.file}
				<pre
					class="overflow-x-auto border-b border-line px-3 py-2 font-mono text-[11.5px] leading-5">{#each excerpt(thread) as line, i (i)}<span
							class={[
								'block',
								line.startsWith('+') && 'text-add',
								line.startsWith('-') && 'text-del',
								line.startsWith('@@') && 'text-faint'
							]}>{line || ' '}</span
						>{/each}</pre>
			{/if}
			<div class="p-3">
				<ReviewComments {thread} {onreply} />
			</div>
		</div>
	{/each}
</div>
