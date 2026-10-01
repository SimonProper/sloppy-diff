import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { ask, cancelAsk, getAskJob, sourceFor, type Question } from '$lib/server/ask';
import { watchJob } from '$lib/server/jobs';
import { badRequestOnError } from '$lib/server/requests';
import { checkScope, checkThreadId, deleteThread } from '$lib/server/threads';
import { applyAskEvent, startAnswer } from './answer';

type ThreadRef = { repo: string; scope: string; thread: string };

/**
 * Asks Claude about lines of the diff from `from` to `to` (empty for the
 * working tree), in a new thread or as a follow-up in `question.thread`.
 */
export const askClaude = command(
	'unchecked',
	({
		repo,
		from,
		to,
		pr,
		...question
	}: { repo: string; from: string; to: string; pr?: number } & Question) =>
		badRequestOnError(async () => {
			const source = await sourceFor(repo, from, to, pr);
			const thread = await ask(source, question);
			return { scope: source.scope, thread };
		})
);

/**
 * The answer being written in a thread, from the start, until it's in. `follow`
 * only keys the stream: Kit keeps a finished one cached for a while, and the
 * thread's next answer mustn't pick it up.
 */
export const followAnswer = query.live(
	'unchecked',
	async function* ({ repo, scope, thread }: ThreadRef & { follow: string }) {
		const job = await badRequestOnError(() => getAskJob(repo, checkScope(scope), thread));
		if (!job) error(404, 'Claude is not answering in this thread');
		yield* watchJob(job, applyAskEvent, startAnswer(), getRequestEvent().request.signal);
	}
);

/** Stops Claude answering. */
export const stopAnswer = command('unchecked', ({ repo, scope, thread }: ThreadRef) =>
	badRequestOnError(() => cancelAsk(repo, checkScope(scope), checkThreadId(thread)))
);

/** Deletes a thread, stopping Claude first if it's still answering. */
export const removeThread = command('unchecked', ({ repo, scope, thread }: ThreadRef) =>
	badRequestOnError(async () => {
		const [s, id] = [checkScope(scope), checkThreadId(thread)];
		cancelAsk(repo, s, id);
		await deleteThread(repo, s, id);
	})
);
