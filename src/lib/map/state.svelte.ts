import { SvelteSet } from 'svelte/reactivity';
import type { Layout } from './layout';
import type { ChangeMap } from './types';

/**
 * What's been done to a change's map: asked, opened, and where it's looked at. Kept while
 * the page is open, so the map is as it was left after a tab switch, like clicking a box
 * to see its diff and coming back, and an answer that arrives meanwhile isn't lost.
 */
export class MapState {
	/** the boxes opened into their members */
	open = new SvelteSet<string>();
	/** what's been asked, `id:way`, and what's still being asked */
	asked = new SvelteSet<string>();
	asking = new SvelteSet<string>();
	more = $state.raw<ChangeMap[]>([]);
	failure = $state('');
	view = $state({ x: 0, y: 0, k: 1 });
	/**
	 * where the layout is drawn from: moved each time the map's laid out again so the box
	 * clicked stays where it was, everything else moving around it
	 */
	origin = $state({ x: 0, y: 0 });
	/** the box or member row clicked: its branch stays lit until it's clicked again */
	selected = $state<string | null>(null);
	/** the last layout: a crowd of boxes keeps what it showed */
	previous: Layout | undefined;
	fitted = false;
}

// ponytail: one per change looked at while the page is open, a reload starts afresh
const states = new Map<string, MapState>();

export function mapState(repo: string, start: string, stop: string): MapState {
	const key = `${repo}\0${start}\0${stop}`;
	return states.get(key) ?? states.set(key, new MapState()).get(key)!;
}
