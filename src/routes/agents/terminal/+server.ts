import { error } from '@sveltejs/kit';
import { watchTerminal } from '$lib/server/terminals';
import type { RequestHandler } from './$types';

/**
 * A terminal's output as server-sent events, what it printed so far first. Not a live query,
 * which keeps only the latest value: every chunk has to arrive, in order.
 */
export const GET: RequestHandler = ({ url }) => {
	let controller!: ReadableStreamDefaultController<string>;
	let stop = () => {};
	const body = new ReadableStream<string>({
		start: (c) => void (controller = c),
		cancel: () => void stop()
	});
	try {
		stop = watchTerminal(url.searchParams.get('id') ?? '', (event) => {
			controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
			// the page stops listening then, rather than EventSource reconnecting
			if ('exit' in event) controller.close();
		});
	} catch (e) {
		error(404, (e as Error).message);
	}
	return new Response(body.pipeThrough(new TextEncoderStream()), {
		headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }
	});
};
