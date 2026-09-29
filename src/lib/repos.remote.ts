import { command, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { cachedScan } from '$lib/server/discover';
import { errorMessage, repoRoot } from '$lib/server/git';
import { pickFolder } from '$lib/server/picker';

/** Git repositories found on this machine. */
export const getRepos = query(() => cachedScan());

/** Scans for repositories again. */
export const rescanRepos = command(async () => {
	const scan = await cachedScan(true);
	getRepos().set(scan);
	return scan;
});

/**
 * Shows the native folder dialog, starting near `near`, and answers with the
 * repository around the chosen folder, or null when it was cancelled.
 */
export const pickRepo = command('unchecked', async (near: string) => {
	let folder: string | null;
	try {
		folder = await pickFolder(near);
	} catch (e) {
		error(500, errorMessage(e));
	}
	if (!folder) return null;

	try {
		// a folder inside a repo opens the whole repo
		return await repoRoot(folder);
	} catch {
		error(400, `${folder} is not inside a git repository`);
	}
});
