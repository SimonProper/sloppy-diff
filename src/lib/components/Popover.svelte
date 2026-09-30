<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { HTMLAttributes, HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		open?: boolean;
		/** the button that toggles it, spread `props` onto a <button> */
		trigger: Snippet<[props: HTMLButtonAttributes]>;
		children: Snippet;
		/** line up with the trigger's left edge, or its right edge */
		align?: 'start' | 'end';
		/** gap to the trigger in pixels */
		offset?: number;
	}

	/**
	 * A button and the panel it toggles.
	 *
	 * <Popover bind:open>
	 *   {#snippet trigger(props)}<button {...props}>Open</button>{/snippet}
	 *   …
	 * </Popover>
	 *
	 * The panel uses the native popover attribute, so it renders in the top
	 * layer above sticky headers and dialogs, and the browser closes it on
	 * Escape or a click outside. Children only render while it is open, so they
	 * mount fresh (and can autofocus) every time.
	 */
	let {
		open = $bindable(false),
		trigger,
		children,
		align = 'start',
		offset = 8,
		...rest
	}: Props = $props();

	const id = $props.id();
	const triggerId = `${id}-trigger`;
	const contentId = `${id}-content`;
	/** CSS anchor name tying the content's position to the trigger */
	const anchor = `--${id}`;

	let content = $state<HTMLDivElement>();

	// popovertarget lets the browser toggle the content and keeps clicks on
	// the trigger from counting as the outside click that closes it
	const triggerProps = $derived<HTMLButtonAttributes>({
		type: 'button',
		id: triggerId,
		popovertarget: contentId,
		'aria-haspopup': 'dialog',
		'aria-expanded': open,
		'aria-controls': contentId,
		style: `anchor-name: ${anchor}`
	});

	// CSS anchor positioning where the browser has it, measured coordinates otherwise
	let anchored = $state(false);
	let placed = $state<{ top: number; left: number } | null>(null);

	onMount(() => {
		anchored = CSS.supports('anchor-name: --a');
	});

	const style = $derived.by(() => {
		if (anchored) {
			return [
				`position-anchor: ${anchor}`,
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
		if (open && !shown) content.showPopover();
		else if (!open && shown) content.hidePopover();
	});

	// the browser opens and closes it too: trigger clicks, Escape, clicks outside
	function ontoggle(event: ToggleEvent) {
		open = event.newState === 'open';
	}

	$effect(() => {
		if (!open || anchored) return;
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
		const button = document.getElementById(triggerId)?.getBoundingClientRect();
		const box = content?.getBoundingClientRect();
		if (!button || !box) return;
		const margin = 8;
		let top = button.bottom + offset;
		if (top + box.height > innerHeight - margin && button.top - offset - box.height > margin) {
			top = button.top - offset - box.height;
		}
		const left = align === 'end' ? button.right - box.width : button.left;
		placed = { top, left: Math.max(margin, Math.min(left, innerWidth - box.width - margin)) };
	}
</script>

{@render trigger(triggerProps)}

<div
	{...rest}
	bind:this={content}
	id={contentId}
	popover="auto"
	aria-labelledby={triggerId}
	{style}
	{ontoggle}
>
	{#if open}
		{@render children()}
	{/if}
</div>
