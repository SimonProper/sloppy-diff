import { error } from '@sveltejs/kit';
import { errorMessage } from '$lib/server/git';
import { deleteGuide } from '$lib/server/guides';
import type { RequestHandler } from './$types';

/** Deletes a saved guide. The repo is the one it was saved for, it may be gone by now. */
export const DELETE: RequestHandler = async ({ url }) => {
	const [repo, start, stop] = ['repo', 'start', 'stop'].map((k) => url.searchParams.get(k) ?? '');
	try {
		await deleteGuide(repo, start, stop);
		return new Response(null, { status: 204 });
	} catch (e) {
		error(400, errorMessage(e));
	}
};
