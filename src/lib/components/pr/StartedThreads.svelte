<script lang="ts">
	import { where } from '$lib/pr/jump';
	import { timeAgo } from '$lib/refs';
	import type { DiffFile } from '$lib/diff/types';
	import type { PrComment, ReviewThread, Replying } from '$lib/pr/types';
	import Comment from './Comment.svelte';
	import CommentField from './CommentField.svelte';
	import HunkPeek from './HunkPeek.svelte';
	import ResolveButton from './ResolveButton.svelte';

	interface Props {
		/** the threads a review started, by id */
		ids: string[];
		threads: Map<string, ReviewThread>;
		onjump: (thread: ReviewThread) => void;
		/** replying to the threads, without it they're read-only */
		reply?: Replying;
		/** yours, beside the reply field */
		avatar?: string;
		/** the diff, to peek at a thread's lines as it draws them */
		files?: DiffFile[];
	}

	let { ids, threads, onjump, reply, avatar = '', files }: Props = $props();

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

<!-- each thread whole, replies and all, framed: its path in a quiet strip on top, the last
     lines of the code it's on, the comments under it on the card's own colour with a line
     between each. A way to it in the diff on hover -->
<ul class="mt-3 flex flex-col gap-2">
	{#each shown as thread (thread.id)}
		{@const { first, skipped, last } = excerpt(thread)}
		<li class="group overflow-hidden rounded-xl border border-line">
			<!-- resolved says so in a pill, a faded thread would only look disabled -->
			<p
				class="flex items-center gap-1.5 border-b border-line bg-subtle px-3 py-1.5 text-[11px] text-faint"
			>
				<span class="truncate font-mono" title={thread.path}>{where(thread)}</span>
				{#if thread.isOutdated}<span>· outdated</span>{/if}
				<span class="ml-auto flex shrink-0 items-center gap-2">
					<button
						type="button"
						class="text-[11px] text-faint opacity-0 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
						onclick={() => onjump(thread)}>Go to comment</button
					>
					{#if thread.isResolved}
						<span class="rounded-sm border border-line px-1 text-[10px] font-medium text-muted"
							>Resolved</span
						>
					{/if}
					<ResolveButton {thread} />
				</span>
			</p>
			<HunkPeek {thread} {files} lines={4} />
			<div class="divide-y divide-line bg-surface">
				{#each first as comment (comment.id)}{@render said(comment)}{/each}
				{#if skipped}
					<p class="py-1.5 pl-9 text-[11px] text-faint">{skipped} more replies</p>
				{/if}
				{#each last as comment (comment.id)}{@render said(comment)}{/each}
				{#if reply}
					<CommentField
						onsend={(body) => reply.send(thread.id, body, !reply.pending)}
						onreview={reply.pending ? undefined : (body) => reply.send(thread.id, body, false)}
						keep={thread.id}
						{avatar}
					/>
				{/if}
			</div>
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
	<div class="px-3 py-2.5"><Comment {comment} /></div>
{/snippet}
