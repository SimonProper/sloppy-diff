import { invalidateAll } from '$app/navigation';
import { page } from '$app/state';

/**
 * Loads the page again after a write to GitHub, in the background: what's shown stays,
 * and this is done once the new read is in, the comment there or gone. It's on GitHub
 * already, a reload that fails isn't a write that failed.
 */
export async function refresh() {
	try {
		await invalidateAll();
		await page.data.diff;
	} catch {
		// shown as it was, the next load catches up
	}
}
