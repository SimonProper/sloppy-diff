import { tick } from 'svelte';

interface ListNav {
	/** index of the active option */
	active: number;
	/** how many options there are */
	count: number;
	/** the listbox, its `[data-active]` option is scrolled into view */
	list?: HTMLElement;
	onmove: (active: number) => void;
	onenter: () => void;
}

/**
 * Arrow keys and Enter for a combobox whose input keeps focus while the arrows
 * move the active option, wrapping at either end.
 */
export function listNav(event: KeyboardEvent, nav: ListNav) {
	if (event.key === 'Enter') {
		event.preventDefault();
		nav.onenter();
		return;
	}
	const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
	if (!delta) return;
	event.preventDefault();
	if (nav.count === 0) return;
	nav.onmove((nav.active + delta + nav.count) % nav.count);
	tick().then(() => nav.list?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' }));
}
