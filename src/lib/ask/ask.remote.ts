import { command } from '$app/server';
import { ask, cancelAsk, sourceFor, type Question } from '$lib/server/ask';
import { badRequestOnError } from '$lib/server/requests';
import { checkScope, checkThreadId, deleteThread } from '$lib/server/threads';

type ThreadRef = { repo: string; scope: string; thread: string };

/**
 * Asks Claude about lines of the diff from `from` to `to` (empty for the
 * working tree), in a new thread or as a follow-up in `question.thread`.
 */
export const askClaude = command(
	'unchecked',
	({ repo, from, to, ...question }: { repo: string; from: string; to: string } & Question) =>
		badRequestOnError(async () => {
			const source = await sourceFor(repo, from, to);
			const thread = await ask(source, question);
			return { scope: source.scope, thread };
		})
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
