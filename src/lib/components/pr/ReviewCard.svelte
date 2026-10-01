<script lang="ts">
	import type { ReviewThread } from '$lib/pr/types';
	import ReviewComments from './ReviewComments.svelte';

	interface Props {
		/** the threads ending on one line */
		threads: ReviewThread[];
		/** the marker it opened from */
		at: DOMRect;
		onclose: () => void;
		onreply?: (thread: string, body: string) => Promise<void>;
	}

	let { threads, at, onclose, onreply }: Props = $props();

	let card: HTMLDivElement;
	let placed = $state<{ top: number; left: number } | null>(null);

	// in the top layer, the browser closes it on Escape or a click outside. Below the
	// marker, above it where there's no room
	$effect(() => {
		card.showPopover();
		const box = card.getBoundingClientRect();
		let top = at.bottom + 6;
		if (top + box.height > innerHeight - 8) top = Math.max(8, at.top - 6 - box.height);
		placed = { top, left: Math.max(8, Math.min(at.left, innerWidth - box.width - 8)) };
		// it stays where it opened, so it closes once the page moves away from the marker
		addEventListener('scroll', onclose);
		return () => removeEventListener('scroll', onclose);
	});
</script>

<div
	bind:this={card}
	popover="auto"
	class="m-0 max-h-[min(28rem,calc(100vh-1rem))] w-[26rem] overflow-y-auto rounded-xl border border-line bg-surface p-3 text-left font-sans shadow-float"
	style:top="{placed?.top ?? 0}px"
	style:left="{placed?.left ?? 0}px"
	style:visibility={placed ? null : 'hidden'}
	ontoggle={(e) => e.newState === 'closed' && onclose()}
>
	{#each threads as thread, i (thread.id)}
		<div class={[i > 0 && 'mt-3 border-t border-line pt-3']}>
			{#if thread.isResolved}
				<p class="mb-2 text-[11px] text-faint">Resolved</p>
			{/if}
			<ReviewComments {thread} {onreply} />
		</div>
	{/each}
</div>
