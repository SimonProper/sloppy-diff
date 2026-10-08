<script module lang="ts">
	import type { ReviewState } from '$lib/pr/types';

	/** A review's verdict as a pill: its label and colours. One that only commented has none */
	export const VERDICTS: Partial<Record<ReviewState, [string, string]>> = {
		APPROVED: ['Approved', 'border-add/40 bg-add/10 text-add'],
		CHANGES_REQUESTED: ['Changes requested', 'border-del/40 bg-del/10 text-del'],
		DISMISSED: ['Dismissed', 'border-line text-muted']
	};
</script>

<script lang="ts">
	import { timeAgo } from '$lib/refs';
	import type { PrComment } from '$lib/pr/types';
	import Avatar from './Avatar.svelte';

	interface Props {
		comment: PrComment;
		/** the threads a review started, counted in its header */
		threads?: number;
	}

	let { comment, threads }: Props = $props();

	const verdict = $derived(comment.review && VERDICTS[comment.review]);
</script>

<!-- the body sits under the name, the avatar alone in its column marks where one starts -->
<p class="flex items-center gap-1.5 text-[11.5px] text-faint">
	<Avatar src={comment.avatar} class="mr-0.5 size-5" />
	<span class="text-[12px] font-medium text-fg">{comment.author}</span>
	{#if comment.pending}
		<span
			class="rounded-[4px] border border-line bg-subtle px-1 text-[10px] font-medium text-fg"
			title="In your pending review, not posted yet">Pending</span
		>
	{/if}
	{#if verdict}
		<span class={['rounded-[4px] border px-1 text-[10px] font-medium', verdict[1]]}
			>{verdict[0]}</span
		>
	{/if}
	{#if threads}
		<span>·</span>
		<span class="tabular-nums">{threads} {threads === 1 ? 'thread' : 'threads'}</span>
		<span>·</span>
	{/if}
	<a
		class="hover:underline"
		href={comment.url}
		target="_blank"
		rel="noopener noreferrer"
		title={new Date(comment.createdAt).toLocaleString()}>{timeAgo(comment.createdAt)} ago</a
	>
</p>
{#if comment.html}
	<div class="prose mt-0.5 pl-7 text-[12.5px] leading-relaxed">{@html comment.html}</div>
{/if}
