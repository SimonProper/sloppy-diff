import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AskEvent, Thread } from '$lib/ask/types';
import { createFixture } from './testing/fixture';

const directory = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-ask-codex-')));
const codex = join(directory, 'codex');
const claude = join(directory, 'claude');
const runs = join(directory, 'runs');
const settings = join(directory, 'settings.json');

function cli(provider: 'codex' | 'claude', path: string) {
	writeFileSync(
		path,
		`#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const settings = JSON.parse(fs.readFileSync(${JSON.stringify(settings)}, 'utf8'));
const runs = ${JSON.stringify(runs)};
fs.mkdirSync(runs, {recursive: true});
const run = path.join(runs, String(fs.readdirSync(runs).length));
fs.mkdirSync(run);
fs.writeFileSync(path.join(run, 'invocation.json'), JSON.stringify({provider: ${JSON.stringify(provider)}, args: process.argv.slice(2), cwd: process.cwd()}));
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', part => prompt += part);
process.stdin.on('end', () => {
  fs.writeFileSync(path.join(run, 'prompt'), prompt);
  const emit = event => process.stdout.write(JSON.stringify(event) + '\\n');
  if (${JSON.stringify(provider)} === 'claude') {
    emit({type: 'system', subtype: 'init', session_id: 'claude-session', model: 'claude-stub'});
    emit({type: 'assistant', message: {content: [{type: 'text', text: 'Claude keeps its own conversation.'}]}});
    emit({type: 'result', session_id: 'claude-session', result: 'Claude keeps its own conversation.', total_cost_usd: 0.02});
    return;
  }
  emit({type: 'thread.started', thread_id: 'codex-session'});
  if (settings.mode === 'hang') { setTimeout(() => {}, 20000); return; }
  if (settings.mode === 'failure' || (settings.mode === 'gone' && process.argv.includes('resume'))) {
    emit({type: 'turn.failed', error: {message: 'No Codex session found'}});
    return;
  }
  emit({type: 'turn.started'});
  emit({type: 'item.completed', item: {id: 'reason', type: 'reasoning', text: 'Inspect the cart behavior.'}});
  emit({type: 'item.completed', item: {id: 'aside', type: 'agent_message', text: 'Let me inspect the cart.'}});
  emit({type: 'item.started', item: {id: 'read', type: 'command_execution', command: 'rg subtotal src/cart.ts', status: 'in_progress'}});
  emit({type: 'item.completed', item: {id: 'read', type: 'command_execution', command: 'rg subtotal src/cart.ts', status: 'completed', exit_code: 0}});
  emit({type: 'item.completed', item: {id: 'answer', type: 'agent_message', text: 'Codex explains the quantity change.'}});
  emit({type: 'turn.completed', usage: {input_tokens: 120, cached_input_tokens: 10, output_tokens: 22}});
});
`
	);
	chmodSync(path, 0o755);
}
cli('codex', codex);
cli('claude', claude);

vi.mock('$env/dynamic/private', () => ({
	env: {
		...process.env,
		AI_PROVIDER: 'codex',
		CODEX_BIN: codex,
		CLAUDE_BIN: claude,
		CODEX_ASK_MODEL: 'codex-stub-model',
		ASK_MODEL: 'claude-stub-model',
		GUIDES_DIR: join(directory, 'guides')
	}
}));

const { ask, cancelAsk, getAskJob, sourceFor } = await import('./ask');
const { loadThreads, saveThread } = await import('./threads');
const { resolveCommit } = await import('./git');
const fixture = createFixture();
const [from, to] = await Promise.all([
	resolveCommit(fixture.root, 'main'),
	resolveCommit(fixture.root, 'change')
]);
const source = await sourceFor(fixture.root, from, to);

beforeEach(() => {
	rmSync(runs, { recursive: true, force: true });
	rmSync(join(directory, 'guides'), { recursive: true, force: true });
	mkdirSync(runs, { recursive: true });
	stub('answer');
});
afterAll(() => {
	fixture.cleanup();
	rmSync(directory, { recursive: true, force: true });
});

function stub(mode: string) {
	writeFileSync(settings, JSON.stringify({ mode }));
}

function invocation(index: number) {
	const run = join(runs, String(index));
	return {
		...(JSON.parse(readFileSync(join(run, 'invocation.json'), 'utf8')) as {
			provider: string;
			args: string[];
			cwd: string;
		}),
		prompt: readFileSync(join(run, 'prompt'), 'utf8')
	};
}

function finished(thread: Thread): Promise<AskEvent> {
	const job = getAskJob(fixture.root, source.scope, thread.id)!;
	return new Promise((resolve) => {
		const last = job.events.at(-1);
		if (last?.type === 'done' || last?.type === 'error') return resolve(last);
		const listener = (event: AskEvent) => {
			if (event.type !== 'done' && event.type !== 'error') return;
			job.listeners.delete(listener);
			resolve(event);
		};
		job.listeners.add(listener);
	});
}

describe('asking Codex', () => {
	test('streams native CLI events, saves the answer, and uses the Codex model', async () => {
		const thread = await ask(source, { text: 'Explain the quantity change.' });
		expect(thread.provider).toBe('codex');
		expect((await finished(thread)).type).toBe('done');
		const [saved] = await loadThreads(fixture.root, source.scope);
		expect(saved).toMatchObject({
			provider: 'codex',
			sessionId: 'codex-session',
			sessionTokens: 142
		});
		expect(saved.messages[1]).toMatchObject({
			text: 'Codex explains the quantity change.',
			provider: 'codex',
			model: 'codex-stub-model'
		});
		expect(saved.messages[1].cost).toBeUndefined();
		expect(saved.sessionCost).toBeUndefined();
		expect(saved.messages[1].steps).toEqual(
			expect.arrayContaining([
				{ type: 'thinking', text: 'Inspect the cart behavior.' },
				{ type: 'text', text: 'Let me inspect the cart.' },
				{ type: 'tool', text: expect.stringContaining('rg subtotal') }
			])
		);
		const run = invocation(0);
		expect(run.provider).toBe('codex');
		expect(run.args).toContain('codex-stub-model');
		expect(run.args).not.toContain('claude-stub-model');
		expect(run.prompt).toContain('Explain the quantity change.');
		expect(run.prompt).toContain(fixture.root);
	});

	test('follow-ups keep their provider when the selected preference changes', async () => {
		const thread = await ask(source, { text: 'First question?' }, 'codex');
		await finished(thread);
		await ask(source, { text: 'And the next question?', thread: thread.id }, 'claude');
		expect((await finished(thread)).type).toBe('done');
		const run = invocation(1);
		expect(run.provider).toBe('codex');
		expect(run.args).toContain('resume');
		expect(run.args).toContain('codex-session');
		expect(run.prompt).toContain('And the next question?');
		expect(run.prompt).not.toContain('Earlier in this conversation');
		const [saved] = await loadThreads(fixture.root, source.scope);
		expect(saved.provider).toBe('codex');
		expect(
			saved.messages
				.filter((message) => message.role === 'assistant')
				.map((message) => message.provider)
		).toEqual(['codex', 'codex']);
	});

	test('legacy threads without provider metadata continue through Claude', async () => {
		const legacy: Thread = {
			id: 'aaaaaabbbbbb',
			anchor: { path: '', code: '', label: 'whole change' },
			createdAt: new Date().toISOString(),
			sessionId: 'legacy-claude-session',
			messages: [
				{ role: 'user', text: 'Earlier question', createdAt: new Date().toISOString() },
				{ role: 'assistant', text: 'Earlier answer', createdAt: new Date().toISOString() }
			]
		};
		await saveThread(fixture.root, source.scope, legacy);
		const thread = await ask(
			source,
			{ text: 'Continue the conversation.', thread: legacy.id },
			'codex'
		);
		expect((await finished(thread)).type).toBe('done');
		const run = invocation(0);
		expect(run.provider).toBe('claude');
		expect(run.args).toContain('legacy-claude-session');
		expect(run.prompt.trim()).toBe('Continue the conversation.');
		const [saved] = await loadThreads(fixture.root, source.scope);
		expect(saved.provider).toBe('claude');
		expect(saved.messages.at(-1)?.provider).toBe('claude');
	});

	test('a missing Codex session restarts with the prior conversation', async () => {
		const thread = await ask(source, { text: 'The first question.' }, 'codex');
		await finished(thread);
		stub('gone');
		await ask(source, { text: 'Continue after losing the session.', thread: thread.id }, 'claude');
		expect((await finished(thread)).type).toBe('done');
		expect(invocation(1).args).toContain('resume');
		const retry = invocation(2);
		expect(retry.provider).toBe('codex');
		expect(retry.args).not.toContain('resume');
		expect(retry.prompt).toContain('Earlier in this conversation');
		expect(retry.prompt).toContain('The first question.');
		expect(retry.prompt).toContain('Codex explains the quantity change.');
	});

	test('a failed initial answer retains its pinned provider for retry', async () => {
		stub('failure');
		const thread = await ask(source, { text: 'Try this question.' }, 'codex');
		expect(await finished(thread)).toEqual({ type: 'error', message: 'No Codex session found' });
		const [failed] = await loadThreads(fixture.root, source.scope);
		expect(failed.provider).toBe('codex');
		expect(failed.messages.at(-1)).toMatchObject({
			error: 'No Codex session found',
			provider: 'codex'
		});
		stub('answer');
		await ask(source, { text: '', thread: thread.id, retry: true }, 'claude');
		expect((await finished(thread)).type).toBe('done');
		expect(invocation(1).provider).toBe('codex');
		const [saved] = await loadThreads(fixture.root, source.scope);
		expect(saved.messages).toHaveLength(2);
	});

	test('cancellation keeps the pinned question and records a cancelled answer', async () => {
		stub('hang');
		const thread = await ask(source, { text: 'A slow question.' }, 'codex');
		await vi.waitFor(() => expect(existsSync(join(runs, '0', 'prompt'))).toBe(true));
		cancelAsk(fixture.root, source.scope, thread.id);
		expect(await finished(thread)).toEqual({ type: 'error', message: 'Cancelled' });
		await vi.waitFor(async () => {
			const [saved] = await loadThreads(fixture.root, source.scope);
			expect(saved.provider).toBe('codex');
			expect(saved.messages.at(-1)).toMatchObject({ error: 'Cancelled', provider: 'codex' });
		});
	});
});
