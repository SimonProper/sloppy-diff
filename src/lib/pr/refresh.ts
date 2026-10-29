import { invalidate, invalidateAll } from '$app/navigation';
import { navigating, page } from '$app/state';

// when the page was last loaded again, by a write or by keepFresh
let last = 0;
// a background read still going, a slow one isn't started again on top of itself
let busy = false;

/**
 * Loads the page again after a write to GitHub, in the background: what's shown stays,
 * and this is done once the new read is in, the comment there or gone. It's on GitHub
 * already, a reload that fails isn't a write that failed.
 */
export async function refresh() {
	last = Date.now();
	try {
		await invalidateAll();
		await page.data.diff;
	} catch {
		// shown as it was, the next load catches up
	}
}

/**
 * Keeps the page current while it's on screen: read again on coming back to the tab or
 * the network, and with `poll` every 30s while the tab is visible, for what moves on
 * GitHub without anything here moving. A read under 5s ago, returning firing both focus
 * and visibilitychange or a write just made, is enough. Only the page's load runs again,
 * not every query on it: one left over from another range would close the language
 * servers the one on screen uses. `also` refreshes the queries that should follow.
 * Returns the cleanup.
 */
export function keepFresh(poll: boolean, also: () => void) {
	// the page was just loaded, focusing it as it lands isn't a reason to load it again
	last = Date.now();
	const tick = async () => {
		if (document.visibilityState !== 'visible' || !navigator.onLine) return;
		// a click being followed would be dropped for the page it leaves
		if (busy || navigating.to || Date.now() - last < 5_000) return;
		busy = true;
		last = Date.now();
		try {
			also();
			await invalidate('app:page');
			await page.data.diff;
		} catch {
			// shown as it was, the next tick catches up
		} finally {
			busy = false;
		}
	};
	const id = poll ? setInterval(tick, 30_000) : undefined;
	const events = ['focus', 'online'] as const;
	for (const event of events) window.addEventListener(event, tick);
	document.addEventListener('visibilitychange', tick);
	return () => {
		clearInterval(id);
		for (const event of events) window.removeEventListener(event, tick);
		document.removeEventListener('visibilitychange', tick);
	};
}
