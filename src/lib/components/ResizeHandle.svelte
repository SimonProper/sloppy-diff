<script module lang="ts">
	import { readText, writeText } from '$lib/storage';

	/** a size saved under `key`, null when there's none */
	export function storedSize(key: string): number | null {
		const value = Number(readText(key));
		return value > 0 ? value : null;
	}
</script>

<script lang="ts">
	interface Props {
		/** size of the panel in px, null while it sizes itself */
		size: number | null;
		/** the panel being resized, measured when a drag starts from its natural size */
		panel: HTMLElement | undefined;
		label: string;
		/** a horizontal line resizes the height of the panel above, a vertical one the width of the panel before */
		orientation?: 'horizontal' | 'vertical';
		/** smallest the panel can get */
		min?: number;
		/** largest the panel can get, by default what the parent has left after `reserve` */
		max?: number;
		reserve?: number;
		/** true while the pointer is dragging */
		dragging?: boolean;
		/** saves the size in this browser under this key, read it back with `storedSize` */
		key?: string;
		/** the panel is after the handle, dragging towards it makes it smaller */
		reverse?: boolean;
	}

	let {
		size = $bindable(),
		panel,
		label,
		orientation = 'horizontal',
		min = 72,
		max,
		reserve = 96,
		dragging = $bindable(false),
		key,
		reverse = false
	}: Props = $props();

	$effect(() => {
		// saved once a drag ends, not on every move
		if (!key || dragging) return;
		writeText(key, size === null ? null : String(size));
	});

	const vertical = $derived(orientation === 'vertical');

	let handle: HTMLElement;
	let origin = 0;
	let from = 0;

	const current = () => (vertical ? panel?.offsetWidth : panel?.offsetHeight) ?? size ?? min;

	function limit(px: number) {
		const parent = handle.parentElement;
		const room =
			max ?? (parent ? (vertical ? parent.clientWidth : parent.clientHeight) : Infinity) - reserve;
		return Math.round(Math.max(min, Math.min(px, room)));
	}

	function pointerdown(event: PointerEvent) {
		if (event.button !== 0) return;
		// no text selection while dragging
		event.preventDefault();
		handle.setPointerCapture(event.pointerId);
		dragging = true;
		origin = vertical ? event.clientX : event.clientY;
		from = current();
	}

	function pointermove(event: PointerEvent) {
		const moved = (vertical ? event.clientX : event.clientY) - origin;
		if (dragging) size = limit(from + (reverse ? -moved : moved));
	}

	function pointerup(event: PointerEvent) {
		dragging = false;
		handle.releasePointerCapture(event.pointerId);
	}

	function keydown(event: KeyboardEvent) {
		const step = event.shiftKey ? 64 : 16;
		let [less, more] = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
		if (reverse) [less, more] = [more, less];
		if (event.key === less) size = limit(current() - step);
		else if (event.key === more) size = limit(current() + step);
		else if (event.key === 'Home') size = limit(min);
		else if (event.key === 'End') size = limit(Infinity);
		else if (event.key === 'Enter' || event.key === 'Escape') size = null;
		else return;
		event.preventDefault();
	}
</script>

<!-- a 1px line with a wider grab area, double-click or Enter goes back to the natural size.
     A focusable separator is ARIA's window splitter widget, svelte only knows the static kind -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={handle}
	role="separator"
	aria-orientation={orientation}
	aria-label={label}
	aria-valuenow={size ?? current()}
	aria-valuemin={min}
	aria-valuemax={max}
	tabindex="0"
	title="Drag to resize, double-click to reset"
	class={[
		'group relative z-10 shrink-0 bg-line outline-none',
		vertical ? 'h-full w-px cursor-col-resize' : 'h-px cursor-row-resize'
	]}
	onpointerdown={pointerdown}
	onpointermove={pointermove}
	onpointerup={pointerup}
	onpointercancel={pointerup}
	ondblclick={() => (size = null)}
	onkeydown={keydown}
>
	<span class={['absolute', vertical ? 'inset-y-0 -right-1 -left-1' : 'inset-x-0 -top-1 -bottom-1']}
	></span>
	<span
		class={[
			'pointer-events-none absolute transition-colors',
			vertical ? 'inset-y-0 -left-px w-[3px]' : 'inset-x-0 -top-px h-[3px]',
			dragging ? 'bg-accent' : 'group-hover:bg-accent/50 group-focus-visible:bg-accent'
		]}
	></span>
</div>
