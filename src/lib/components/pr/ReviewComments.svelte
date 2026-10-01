<script lang="ts">
	import { timeAgo } from '$lib/refs';
	import type { ReviewThread } from '$lib/pr/types';

	let { thread }: { thread: ReviewThread } = $props();
</script>

<!-- read-only, replying happens on GitHub -->
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
