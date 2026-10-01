<script lang="ts">
	import { errorText } from '$lib/errors';
	import { timeAgo } from '$lib/refs';
	import type { ReviewThread } from '$lib/pr/types';
	import AskField from '../ask/AskField.svelte';

	interface Props {
		thread: ReviewThread;
		/** adds a reply to your pending review, without it the thread is read-only */
		onreply?: (thread: string, body: string) => Promise<void>;
	}

	let { thread, onreply }: Props = $props();

	let reply = $state('');
	let sending = $state(false);
	let failure = $state('');

	async function send(body: string) {
		if (!onreply) return;
		sending = true;
		failure = '';
		try {
			await onreply(thread.id, body);
			reply = '';
		} catch (e) {
			failure = errorText(e);
		} finally {
			sending = false;
		}
	}
</script>

<ul class="flex flex-col gap-3">
	{#each thread.comments as comment (comment.id)}
		<li>
			<p class="flex items-center gap-1.5 text-[11.5px] text-faint">
				<span class="font-medium text-fg">{comment.author}</span>
				{#if comment.pending}
					<span
						class="rounded-[4px] border border-mod/40 bg-mod/10 px-1 text-[10px] font-medium text-mod"
						title="In your pending review, not posted yet">Pending</span
					>
				{/if}
				<a
					class="hover:underline"
					href={comment.url}
					target="_blank"
					rel="noopener noreferrer"
					title={new Date(comment.createdAt).toLocaleString()}>{timeAgo(comment.createdAt)} ago</a
				>
			</p>
			<div class="prose mt-1 text-[12.5px] leading-relaxed">{@html comment.html ?? ''}</div>
		</li>
	{/each}
</ul>

{#if onreply}
	<div class="mt-3">
		<AskField
			bind:value={reply}
			placeholder="Reply"
			hints={['', '↵ to add to your review']}
			busy={sending}
			onsend={send}
		/>
		{#if failure}
			<p class="px-2.5 pt-1.5 text-[12px] text-del">{failure}</p>
		{/if}
	</div>
{/if}
