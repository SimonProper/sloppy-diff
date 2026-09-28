import { error, json } from '@sveltejs/kit';
import { ask, cancelAsk, sourceFor } from '$lib/server/ask';
import { errorMessage } from '$lib/server/git';
import { checkScope, checkThreadId } from '$lib/server/threads';
import type { RequestHandler } from './$types';

/**
 * Asks Claude about lines of the diff from `from` to `to` (empty for the
 * working tree), in a new thread or as a follow-up in `thread`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { repo, from, to, question, span, thread, section, retry } = await request.json();
	try {
		const source = await sourceFor(String(repo ?? ''), String(from ?? ''), String(to ?? ''));
		const saved = await ask(source, {
			text: String(question ?? ''),
			span,
			thread: thread ? String(thread) : undefined,
			section: section ? String(section) : undefined,
			retry: retry === true
		});
		return json({ scope: source.scope, thread: saved });
	} catch (e) {
		error(400, errorMessage(e));
	}
};

/** Stops Claude answering. */
export const DELETE: RequestHandler = async ({ url }) => {
	const [repo, scope, thread] = ['repo', 'scope', 'thread'].map(
		(k) => url.searchParams.get(k) ?? ''
	);
	try {
		cancelAsk(repo, checkScope(scope), checkThreadId(thread));
		return new Response(null, { status: 204 });
	} catch (e) {
		error(400, errorMessage(e));
	}
};
