<script lang="ts">
	import { where } from '$lib/pr/jump';
	import { glance } from '$lib/pr/text';
	import { timeAgo } from '$lib/refs';
	import type { PrComment, ReviewThread } from '$lib/pr/types';
	import Avatar from './Avatar.svelte';

	interface Props {
		/** the threads a review started, by id */
		ids: string[];
		threads: Map<string, ReviewThread>;
		onjump: (thread: ReviewThread) => void;
	}

	let { ids, threads, onjump }: Props = $props();

	// the first few, the rest a click away. Hiding two or fewer isn't worth a button
	const FIRST = 5;
	let all = $state(false);
	const started = $derived(ids.flatMap((id) => threads.get(id) ?? []));
	const shown = $derived(all || started.length - FIRST <= 2 ? started : started.slice(0, FIRST));

	/** A long thread's first comment and its last two, the ones between counted. */
	function excerpt(t: ReviewThread) {
		const { comments } = t;
		if (comments.length <= 5) return { first: comments, skipped: 0, last: [] };
		return { first: comments.slice(0, 1), skipped: comments.length - 3, last: comments.slice(-2) };
	}
</script>

<!-- each thread whole, replies and all, in a quiet fill with its path on top: a step
     lighter than the card it's in, as every level is than the one around it. A way to
     it in the diff, where the card shows every comment in full -->
<ul class="mt-3 flex flex-col gap-2">
	{#each shown as thread (thread.id)}
		{@const { first, skipped, last } = excerpt(thread)}
		<li>
			<button
				type="button"
				class="block w-full rounded-md bg-subtle px-3 py-2.5 text-left hover:bg-line/50 focus-visible:outline-1 focus-visible:outline-line"
				onclick={() => onjump(thread)}
			>
				<!-- resolved says so in a pill, a faded thread would only look disabled -->
				<span class="flex items-center gap-1.5 text-[11px] text-faint"
					><span class="truncate font-mono" title={thread.path}>{where(thread)}</span
					>{#if thread.isOutdated}<span>· outdated</span>{/if}{#if thread.isResolved}<span
							class="ml-auto shrink-0 rounded-[4px] border border-line px-1 text-[10px] font-medium text-muted"
							>Resolved</span
						>{/if}</span
				>
				<span class="mt-2 flex flex-col gap-2">
					{#each first as comment (comment.id)}{@render said(comment)}{/each}
					{#if skipped}
						<span class="pl-6 text-[11px] text-faint">{skipped} more replies</span>
					{/if}
					{#each last as comment (comment.id)}{@render said(comment)}{/each}
				</span>
			</button>
		</li>
	{/each}
	{#if shown.length < started.length}
		<li>
			<button
				type="button"
				class="py-1 text-[11.5px] text-faint hover:text-fg"
				onclick={() => (all = true)}>+ {started.length - shown.length} more threads</button
			>
		</li>
	{/if}
</ul>

{#snippet said(comment: PrComment)}
	<span class="block">
		<span class="flex items-center gap-2 text-[11px] text-faint">
			<Avatar src={comment.avatar} />
			<span class="text-[11.5px] font-medium text-fg">{comment.author}</span>
			{timeAgo(comment.createdAt)} ago
		</span>
		<span class="mt-0.5 line-clamp-3 pl-6 text-[12px] leading-relaxed text-fg"
			>{glance(comment.html)}</span
		>
	</span>
{/snippet}
