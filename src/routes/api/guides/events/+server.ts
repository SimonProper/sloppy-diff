import { error } from '@sveltejs/kit';
import { getJob } from '$lib/server/generate';
import type { GuideEvent } from '$lib/guide/types';
import type { RequestHandler } from './$types';

/**
 * Streams a generation's progress as NDJSON: everything so far, then live
 * events until it finishes. Reconnecting replays from the start.
 */
export const GET: RequestHandler = ({ url }) => {
	const [repo, start, stop] = ['repo', 'start', 'stop'].map((k) => url.searchParams.get(k) ?? '');
	const job = getJob(repo, start, stop);
	if (!job) error(404, 'No guide is being generated for this range');

	const encoder = new TextEncoder();
	let listener: ((event: GuideEvent) => void) | undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (event: GuideEvent) =>
				controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));

			job.events.forEach(send);
			if (job.finished) {
				controller.close();
				return;
			}
			listener = (event) => {
				send(event);
				if (job.finished) {
					job.listeners.delete(listener!);
					controller.close();
				}
			};
			job.listeners.add(listener);
		},
		cancel() {
			if (listener) job.listeners.delete(listener);
		}
	});

	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' }
	});
};
