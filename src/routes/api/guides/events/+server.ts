import { error } from '@sveltejs/kit';
import { getJob } from '$lib/server/generate';
import { streamJob } from '$lib/server/jobs';
import type { RequestHandler } from './$types';

/**
 * Streams a generation's progress as NDJSON: everything so far, then live
 * events until it finishes. Reconnecting replays from the start.
 */
export const GET: RequestHandler = ({ url }) => {
	const [repo, start, stop] = ['repo', 'start', 'stop'].map((k) => url.searchParams.get(k) ?? '');
	const job = getJob(repo, start, stop);
	if (!job) error(404, 'No guide is being generated for this range');
	return streamJob(job);
};
