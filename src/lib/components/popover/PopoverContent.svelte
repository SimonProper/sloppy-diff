<script lang="ts">
	import { onMount } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { usePopover } from './context.svelte';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** line up with the trigger's left edge, or its right edge */
		align?: 'start' | 'end';
		/** gap to the trigger in pixels */
		offset?: number;
	}

	/**
	 * The floating part of a Popover. It uses the native popover attribute, so
	 * it renders in the top layer above sticky headers and dialogs, and the
	 * browser closes it on Escape or a click outside. Children only render
	 * while it is open, so they mount fresh (and can autofocus) every time.
	 */
	let { align = 'start', offset = 8, children, ...rest }: Props = $props();

	const popover = usePopover();
	let content = $state<HTMLDivElement>();

	// CSS anchor positioning where the browser has it, measured coordinates otherwise
	let anchored = $state(false);
	let placed = $state<{ top: number; left: number } | null>(null);

	onMount(() => {
		anchored = CSS.supports('anchor-name: --a');
	});

	const style = $derived.by(() => {
		if (anchored) {
			return [
				`position-anchor: ${popover.anchor}`,
				'top: anchor(bottom)',
				align === 'end' ? 'right: anchor(right)' : 'left: anchor(left)',
				`margin-top: ${offset}px`,
				// flips above the trigger when there is no room below
				'position-try-fallbacks: flip-block, flip-inline'
			].join(';');
		}
		return placed ? `top: ${placed.top}px; left: ${placed.left}px` : 'visibility: hidden';
	});

	// the state can change from outside (a pick closes it), keep the element in step
	$effect(() => {
		if (!content) return;
		const shown = content.matches(':popover-open');
		if (popover.open && !shown) content.showPopover();
		else if (!popover.open && shown) content.hidePopover();
	});

	// the browser opens and closes it too: trigger clicks, Escape, clicks outside
	function ontoggle(event: ToggleEvent) {
		popover.open = event.newState === 'open';
	}

	$effect(() => {
		if (!popover.open || anchored) return;
		place();
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		return () => {
			window.removeEventListener('scroll', place, true);
			window.removeEventListener('resize', place);
			placed = null;
		};
	});

	function place() {
		const trigger = popover.trigger?.getBoundingClientRect();
		const box = content?.getBoundingClientRect();
		if (!trigger || !box) return;
		const margin = 8;
		let top = trigger.bottom + offset;
		if (top + box.height > innerHeight - margin && trigger.top - offset - box.height > margin) {
			top = trigger.top - offset - box.height;
		}
		const left = align === 'end' ? trigger.right - box.width : trigger.left;
		placed = { top, left: Math.max(margin, Math.min(left, innerWidth - box.width - margin)) };
	}
</script>

<div
	{...rest}
	bind:this={content}
	id={popover.contentId}
	popover="auto"
	aria-labelledby={popover.triggerId}
	{style}
	{ontoggle}
>
	{#if popover.open}
		{@render children?.()}
	{/if}
</div>
