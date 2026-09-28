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

/**
 * Background jobs of one kind. A job runs until it emits `done` or `error`,
 * every event is kept so a page that reconnects can replay it from the start.
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
 * Streams a job's events as NDJSON: everything so far, then live events
 * until it finishes. Reconnecting replays from the start.
 */
export function streamJob<E>(job: Job<E>): Response {
	const encoder = new TextEncoder();
	let listener: ((event: E) => void) | undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (event: E) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));

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
}
