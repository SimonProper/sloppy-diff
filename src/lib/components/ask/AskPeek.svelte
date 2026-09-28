<script lang="ts">
	import type { Threads } from '$lib/ask/threads.svelte';

	interface Props {
		threads: Threads;
	}

	let { threads }: Props = $props();

	const peek = $derived(threads.open ? null : threads.peek);
	const thread = $derived(threads.get(peek?.id ?? null));
	const live = $derived(thread ? threads.live[thread.id] : undefined);
	const question = $derived(thread?.messages.findLast((m) => m.role === 'user')?.text ?? '');
	const answer = $derived(thread?.messages.findLast((m) => m.role === 'assistant'));
	// the start of the answer as plain text, markdown's marks left out
	const gist = $derived(
		(answer?.text ?? '')
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/[*_`#>|]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
	);
</script>

{#if peek && thread}
	<!-- opens to the left of the dot, which sits at the diff's right edge -->
	<div
		class="pointer-events-none fixed z-30 w-[340px] rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[12px] leading-normal shadow-float"
		style:top="{peek.y - 6}px"
		style:right="{window.innerWidth - peek.x + 10}px"
		role="tooltip"
	>
		<p class="truncate font-medium">{question}</p>
		<p class="mt-1 line-clamp-3 text-muted">
			{#if live}
				{live.status}…
			{:else if answer?.error}
				<span class={answer.error === 'Cancelled' ? '' : 'text-del'}
					>{answer.error === 'Cancelled' ? 'Stopped' : `Couldn't answer: ${answer.error}`}</span
				>
			{:else}
				{gist || 'No answer yet'}
			{/if}
		</p>
		<p class="mt-2 text-[11px] text-faint">
			{thread.anchor.label} · click to open
		</p>
	</div>
{/if}
