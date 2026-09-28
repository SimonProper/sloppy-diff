<script lang="ts">
	import type { Snippet } from 'svelte';
	import { PopoverState, setPopover } from './context.svelte';

	/**
	 * Groups a PopoverTrigger with its PopoverContent.
	 *
	 * <Popover bind:open>
	 *   <PopoverTrigger>Open</PopoverTrigger>
	 *   <PopoverContent>…</PopoverContent>
	 * </Popover>
	 */
	let { open = $bindable(false), children }: { open?: boolean; children: Snippet } = $props();

	const id = $props.id();

	setPopover(
		new PopoverState(
			id,
			() => open,
			(value) => (open = value)
		)
	);
</script>

{@render children()}
