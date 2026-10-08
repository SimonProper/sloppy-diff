<script lang="ts">
	import { untrack } from 'svelte';
	import type { ReviewThread } from '$lib/pr/types';
	import ReviewComments from './ReviewComments.svelte';

	interface Props {
		/** the threads ending on one line */
		threads: ReviewThread[];
		/** the marker it opened from */
		at: DOMRect;
		onclose: () => void;
		onreply?: (thread: string, body: string) => Promise<unknown>;
	}

	let { threads, at, onclose, onreply }: Props = $props();

	let card: HTMLDivElement;
	let placed = $state<{ top: number; left: number } | null>(null);
	// the side of the marker it opened on, kept as it follows the marker
	let below = true;

	function place(marker: DOMRect, opening = false) {
		const box = card.getBoundingClientRect();
		if (opening) below = marker.bottom + 6 + box.height <= innerHeight - 8;
		const top = below
			? marker.bottom + 6
			: opening
				? Math.max(8, marker.top - 6 - box.height)
				: marker.top - 6 - box.height;
		placed = { top, left: Math.max(8, Math.min(marker.left, innerWidth - box.width - 8)) };
	}

	// in the top layer, the browser closes it on Escape or a click outside. Below the
	// marker, above it where there's no room
	$effect(() => {
		card.showPopover();
		place(at, true);
		// it moves with the page, its marker found again each time in case the diff drew it anew
		const id = untrack(() => threads[0]?.id);
		const follow = () => {
			const marker = id && document.querySelector(`[data-review~="${CSS.escape(id)}"]`);
			if (marker) place(marker.getBoundingClientRect());
		};
		addEventListener('scroll', follow, { capture: true, passive: true });
		addEventListener('resize', follow);
		return () => {
			removeEventListener('scroll', follow, { capture: true });
			removeEventListener('resize', follow);
		};
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
