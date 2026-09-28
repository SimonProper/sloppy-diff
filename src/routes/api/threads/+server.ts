import { error } from '@sveltejs/kit';
import { cancelAsk } from '$lib/server/ask';
import { errorMessage } from '$lib/server/git';
import { checkScope, checkThreadId, deleteThread } from '$lib/server/threads';
import type { RequestHandler } from './$types';

/** Deletes a thread, stopping Claude first if it's still answering. */
export const DELETE: RequestHandler = async ({ url }) => {
	const [repo, scope, thread] = ['repo', 'scope', 'thread'].map(
		(k) => url.searchParams.get(k) ?? ''
	);
	try {
		const [s, id] = [checkScope(scope), checkThreadId(thread)];
		cancelAsk(repo, s, id);
		await deleteThread(repo, s, id);
		return new Response(null, { status: 204 });
	} catch (e) {
		error(400, errorMessage(e));
	}
};
