<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { usePopover } from './context.svelte';

	/** A button that toggles its Popover's content, any button attribute passes through. */
	let { children, ...rest }: HTMLButtonAttributes = $props();

	const popover = usePopover();
</script>

<!-- popovertarget lets the browser toggle the content and keeps clicks on
     the trigger from counting as the outside click that closes it -->
<button
	type="button"
	{...rest}
	bind:this={popover.trigger}
	id={popover.triggerId}
	popovertarget={popover.contentId}
	aria-haspopup="dialog"
	aria-expanded={popover.open}
	aria-controls={popover.contentId}
	style:anchor-name={popover.anchor}
>
	{@render children?.()}
</button>
