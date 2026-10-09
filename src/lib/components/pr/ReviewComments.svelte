<script lang="ts">
	import type { ReviewThread } from '$lib/pr/types';
	import Comment from './Comment.svelte';
	import ThreadReply from './ThreadReply.svelte';

	interface Props {
		thread: ReviewThread;
		/** adds a reply to your pending review, without it the thread is read-only */
		onreply?: (thread: string, body: string) => Promise<unknown>;
	}

	let { thread, onreply }: Props = $props();
</script>

<ul class="flex flex-col gap-3">
	{#each thread.comments as comment (comment.id)}
		<li><Comment {comment} /></li>
	{/each}
</ul>

{#if onreply}
	<div class="mt-3">
		<ThreadReply thread={thread.id} {onreply} />
	</div>
{/if}
