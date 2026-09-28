import { error } from '@sveltejs/kit';
import { getAskJob } from '$lib/server/ask';
import { errorMessage } from '$lib/server/git';
import { streamJob } from '$lib/server/jobs';
import { checkScope } from '$lib/server/threads';
import type { RequestHandler } from './$types';

/**
 * Streams an answer as NDJSON: everything so far, then live events until it
 * finishes. Reconnecting replays from the start.
 */
export const GET: RequestHandler = ({ url }) => {
	const [repo, scope, thread] = ['repo', 'scope', 'thread'].map(
		(k) => url.searchParams.get(k) ?? ''
	);
	let job;
	try {
		job = getAskJob(repo, checkScope(scope), thread);
	} catch (e) {
		error(400, errorMessage(e));
	}
	if (!job) error(404, 'Claude is not answering in this thread');
	return streamJob(job);
};
