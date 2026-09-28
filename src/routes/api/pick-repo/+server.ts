import { error, json } from '@sveltejs/kit';
import { errorMessage, repoRoot } from '$lib/server/git';
import { pickFolder } from '$lib/server/picker';
import type { RequestHandler } from './$types';

/**
 * Shows the native folder dialog and answers with the repository around the
 * chosen folder, `{ cancelled: true }`, or a 400 when it isn't a git repo.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { near } = await request.json().catch(() => ({ near: undefined }));

	let folder: string | null;
	try {
		folder = await pickFolder(typeof near === 'string' ? near : undefined);
	} catch (e) {
		error(500, errorMessage(e));
	}
	if (!folder) return json({ cancelled: true });

	try {
		// a folder inside a repo opens the whole repo
		return json({ repo: await repoRoot(folder) });
	} catch {
		error(400, `${folder} is not inside a git repository`);
	}
};
