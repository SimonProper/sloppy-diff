import { describe, expect, test } from 'vitest';
import { applyAskEvent, startAnswer } from '$lib/ask/answer';
import type { AskEvent } from '$lib/ask/types';
import { jobQueue, watchJob, type Job } from './jobs';

type Event = { type: 'tick'; n: number } | { type: 'done' } | { type: 'error'; message: string };

const sum = (total: number, event: Event) => (event.type === 'tick' ? total + event.n : total);

/** A job that only emits when the test says so. */
function manual(name: string) {
	const queue = jobQueue<Event>(name);
	let job!: Job<Event>;
	queue.start(name, async (started) => {
		job = started;
	});
	return { job, emit: (event: Event) => queue.emit(job, event) };
}

async function collect<S>(states: AsyncIterable<S>): Promise<S[]> {
	const seen: S[] = [];
	for await (const state of states) seen.push(state);
	return seen;
}

describe('watchJob', () => {
	test('a finished job is its final state, once', async () => {
		const { job, emit } = manual('watch-finished');
		emit({ type: 'tick', n: 2 });
		emit({ type: 'tick', n: 3 });
		emit({ type: 'done' });
		expect(await collect(watchJob(job, sum, 0))).toEqual([5]);
	});

	test('what was said before, then each change until it finishes', async () => {
		const { job, emit } = manual('watch-live');
		emit({ type: 'tick', n: 1 });
		const states = collect(watchJob(job, sum, 0));
		await new Promise((resolve) => setTimeout(resolve, 10));
		emit({ type: 'tick', n: 2 });
		await new Promise((resolve) => setTimeout(resolve, 100));
		emit({ type: 'tick', n: 3 });
		emit({ type: 'done' });
		expect(await states).toEqual([1, 3, 6]);
	});

	test('stops when the page goes away', async () => {
		const { job } = manual('watch-abort');
		const controller = new AbortController();
		const states = collect(watchJob(job, sum, 0, controller.signal));
		controller.abort();
		expect(await states).toEqual([0]);
		expect(job.listeners.size).toBe(0);
	});

	test('what was sent keeps its value as the state moves on', async () => {
		const { job, emit } = manual('watch-copy');
		const push = (list: number[], event: Event) => {
			if (event.type === 'tick') list.push(event.n);
			return list;
		};
		const states = collect(watchJob(job, push, []));
		await new Promise((resolve) => setTimeout(resolve, 10));
		emit({ type: 'tick', n: 1 });
		emit({ type: 'done' });
		expect(await states).toEqual([[], [1]]);
	});
});

test('an answer keeps what was said on the way apart from the answer', () => {
	const events: AskEvent[] = [
		{ type: 'text', text: 'Let me look. ' },
		{ type: 'tool', text: 'Reading src/a.ts' },
		{ type: 'thinking', text: 'Hmm, ' },
		{ type: 'thinking', text: 'right.' },
		{ type: 'text', text: 'It ' },
		{ type: 'text', text: 'returns early.' },
		{ type: 'thinking_tokens', tokens: 40 }
	];
	expect(events.reduce(applyAskEvent, startAnswer())).toEqual({
		status: 'Answering',
		steps: [
			{ type: 'text', text: 'Let me look.' },
			{ type: 'tool', text: 'Reading src/a.ts' },
			{ type: 'thinking', text: 'Hmm, right.' }
		],
		text: 'It returns early.',
		thinkingTokens: 40
	});
});
