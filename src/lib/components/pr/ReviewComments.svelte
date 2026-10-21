<script lang="ts">
	import type { ReviewThread, Replying } from '$lib/pr/types';
	import Comment from './Comment.svelte';
	import CommentField from './CommentField.svelte';

	interface Props {
		thread: ReviewThread;
		/** replying to the thread, without it it's read-only */
		reply?: Replying;
	}

	let { thread, reply }: Props = $props();
</script>

<ul class="flex flex-col gap-3">
	{#each thread.comments as comment (comment.id)}
		<li><Comment {comment} /></li>
	{/each}
</ul>

{#if reply}
	<div class="mt-3">
		<CommentField
			onsend={(body) => reply.send(thread.id, body, !reply.pending)}
			onreview={reply.pending ? undefined : (body) => reply.send(thread.id, body, false)}
			keep={thread.id}
		/>
	</div>
{/if}
