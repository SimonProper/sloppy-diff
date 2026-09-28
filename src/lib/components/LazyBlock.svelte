<script lang="ts">
	import type { Snippet } from 'svelte';
	import { watch } from '$lib/lazy';

	interface Props {
		/** height in px before it has been rendered */
		estimate: number;
		/** false renders it right away and keeps it, the browser still skips laying it out off screen */
		lazy?: boolean;
		children: Snippet;
	}

	let { estimate, lazy = true, children }: Props = $props();

	let el: HTMLElement;
	// svelte-ignore state_referenced_locally
	let shown = $state(!lazy);
	/** its real height, taken when it's put away again */
	let measured = $state<number | null>(null);
	const size = $derived(measured ?? estimate);

	$effect(() => {
		if (!lazy) {
			shown = true;
			return;
		}
		return watch(el, (near) => {
			if (near) shown = true;
			else if (shown) {
				measured = el.offsetHeight;
				shown = false;
			}
		});
	});
</script>

<!-- only rendered near the viewport, a spacer of the same height elsewhere. While
     rendered but off screen, content-visibility has the browser skip laying it out -->
<div
	bind:this={el}
	class="lazy"
	style:height={shown ? null : `${size}px`}
	style:contain-intrinsic-block-size="auto {size}px"
>
	{#if shown}{@render children()}{/if}
</div>

<style>
	.lazy {
		content-visibility: auto;
	}
</style>
