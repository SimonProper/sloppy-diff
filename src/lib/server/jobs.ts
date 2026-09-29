import type { ChildProcess } from 'node:child_process';
import { errorMessage } from './git';

/** Something Claude is working on in the background, and what it has said so far. */
export interface Job<E> {
	key: string;
	events: E[];
	listeners: Set<(event: E) => void>;
	finished: boolean;
	child?: ChildProcess;
}

type Final = { type: 'done' } | { type: 'error'; message: string };

/** How long a finished job's events stay around for a page that reconnects. */
const KEEP_FINISHED_MS = 5 * 60_000;

/** How long a watcher waits for more events before sending the state on. */
const BATCH_MS = 50;

/**
 * Background jobs of one kind. A job runs until it emits `done` or `error`,
 * every event is kept so a page that reconnects gets the whole state again.
 */
export function jobQueue<E extends { type: string }>(name: string) {
	// kept on globalThis so a dev server module reload doesn't orphan running jobs
	const store = globalThis as { __jobs?: Map<string, Map<string, Job<E>>> };
	const all = (store.__jobs ??= new Map());
	const jobs = all.get(name) ?? new Map<string, Job<E>>();
	all.set(name, jobs);

	function emit(job: Job<E>, event: E) {
		if (job.finished) return;
		job.events.push(event);
		if (event.type === 'done' || event.type === 'error') {
			job.finished = true;
			setTimeout(() => {
				if (jobs.get(job.key) === job) jobs.delete(job.key);
			}, KEEP_FINISHED_MS).unref();
		}
		for (const listener of job.listeners) listener(event);
	}

	return {
		get: (key: string) => jobs.get(key),
		emit,

		/** Starts `run` under `key`, or joins the job already running there. */
		start(key: string, run: (job: Job<E>) => Promise<void>): Job<E> {
			const running = jobs.get(key);
			if (running && !running.finished) return running;

			const job: Job<E> = { key, events: [], listeners: new Set(), finished: false };
			jobs.set(key, job);
			run(job).catch((error) => {
				job.child?.kill();
				emit(job, { type: 'error', message: errorMessage(error) } as Final as E);
			});
			return job;
		},

		cancel(key: string) {
			const job = jobs.get(key);
			if (job && !job.finished) {
				job.child?.kill();
				emit(job, { type: 'error', message: 'Cancelled' } as Final as E);
			}
		}
	};
}

/**
 * The job's state after everything it has said so far, then again after each
 * new event until it finishes. Events that arrive together are folded into one
 * state, so a fast stream of text doesn't send the whole answer every token.
 */
export async function* watchJob<E, S>(
	job: Job<E>,
	fold: (state: S, event: E) => S,
	state: S,
	signal?: AbortSignal
): AsyncGenerator<S> {
	let folded = 0;
	let wake: (() => void) | undefined;
	const listener = () => wake?.();
	job.listeners.add(listener);
	signal?.addEventListener('abort', listener);
	try {
		for (;;) {
			while (folded < job.events.length) state = fold(state, job.events[folded++]);
			// a copy, the fold changes the state in place while this one is on its way
			yield structuredClone(state);
			if (job.finished || signal?.aborted) return;
			if (folded === job.events.length) {
				await new Promise<void>((resolve) => (wake = resolve));
				await new Promise((resolve) => setTimeout(resolve, BATCH_MS));
			}
		}
	} finally {
		job.listeners.delete(listener);
		signal?.removeEventListener('abort', listener);
	}
}
