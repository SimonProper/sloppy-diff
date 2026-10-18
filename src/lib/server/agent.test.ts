import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AgentEvent } from './agent';

const directory = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-agent-test-')));
const binary = join(directory, 'agent');
const specPath = join(directory, 'spec.json');
const recordPath = join(directory, 'run.json');
writeFileSync(
	binary,
	`#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
const spec = JSON.parse(readFileSync(${JSON.stringify(specPath)}, 'utf8'));
const args = process.argv.slice(2);
const schemaIndex = args.indexOf('--output-schema');
const schemaPath = schemaIndex < 0 ? undefined : args[schemaIndex + 1];
const record = { args, cwd: process.cwd(), schemaPath, schema: schemaPath ? JSON.parse(readFileSync(schemaPath, 'utf8')) : undefined, input: '', extraDirectories: process.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD };
writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(record));
if (spec.quitBeforeInput) process.exit(spec.exitCode ?? 1);
if (spec.hang) setInterval(() => {}, 1000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => record.input += chunk);
process.stdin.on('end', async () => {
  writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(record));
  if (spec.hang) return;
  for (const event of spec.events ?? []) {
    process.stdout.write((typeof event === 'string' ? event : JSON.stringify(event)) + '\\n');
  }
  if (spec.stderr) process.stderr.write(spec.stderr);
  process.exitCode = spec.exitCode ?? 0;
});
`
);
chmodSync(binary, 0o755);
const privateEnv = { CODEX_BIN: binary, CLAUDE_BIN: binary };
vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
const { runAgent } = await import('./agent');

afterAll(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => {
	privateEnv.CODEX_BIN = binary;
	privateEnv.CLAUDE_BIN = binary;
	rmSync(recordPath, { force: true });
	writeFileSync(specPath, JSON.stringify({ events: [] }));
});

const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
const options = () => ({
	provider: 'codex' as const,
	cwd: directory,
	root: join(directory, 'reviewed-project'),
	input: 'Explain the change.',
	onSpawnError: vi.fn()
});
function stub(spec: Record<string, unknown>) {
	writeFileSync(specPath, JSON.stringify(spec));
}
function record() {
	return JSON.parse(readFileSync(recordPath, 'utf8')) as {
		args: string[];
		cwd: string;
		schemaPath?: string;
		schema?: unknown;
		input: string;
		extraDirectories?: string;
	};
}
async function collect(events: AsyncIterable<AgentEvent>) {
	const result: AgentEvent[] = [];
	for await (const event of events) result.push(event);
	return result;
}
const codexAnswer = [
	{ type: 'thread.started', thread_id: 'codex-session' },
	{ type: 'turn.started' },
	{ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'The answer.' } },
	{
		type: 'turn.completed',
		usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20 }
	}
];

describe('Codex adapter', () => {
	test('runs in isolated configuration with read-only tools and absolute source context', async () => {
		stub({ events: codexAnswer });
		const run = await runAgent({
			...options(),
			dirs: ['/extra/context'],
			system: 'Be concise.',
			model: 'codex-model'
		});
		const events = await collect(run.events);
		expect(await run.exited).toBe(0);
		const actual = record();
		expect(actual.cwd).not.toBe(directory);
		expect(actual.cwd).not.toBe(options().root);
		expect(actual.args.slice(0, 3)).toEqual(['--no-daemon', 'exec', '--json']);
		expect(actual.args).toEqual(
			expect.arrayContaining([
				'--ignore-user-config',
				'--ignore-rules',
				'--skip-git-repo-check',
				'sandbox_mode="read-only"',
				'approval_policy="never"',
				'sandbox_workspace_write.network_access=false',
				'web_search="disabled"',
				'mcp_servers={}',
				'--model',
				'codex-model'
			])
		);
		expect(actual.args.some((arg) => arg.includes('bypass'))).toBe(false);
		expect(actual.args).not.toContain('--add-dir');
		expect(actual.input).toContain(options().root);
		expect(actual.input).toContain(directory);
		expect(actual.input).toContain('/extra/context');
		expect(actual.input).toContain('Be concise.');
		expect(actual.input).toContain('Explain the change.');
		expect(existsSync(actual.cwd)).toBe(false);
		expect(events[0]).toEqual({ type: 'init', sessionId: 'codex-session', model: 'codex-model' });
		expect(events.at(-1)).toMatchObject({
			type: 'result',
			text: 'The answer.',
			sessionId: 'codex-session',
			contextTokens: 120,
			error: undefined
		});
		expect(events.at(-1)).not.toHaveProperty('sessionCost');
	});

	test('resumes the requested session and reads structured schema from a temporary file', async () => {
		stub({
			events: [
				...codexAnswer.slice(0, 2),
				{
					type: 'item.completed',
					item: { id: 'answer', type: 'agent_message', text: '{"title":"A guide"}' }
				},
				codexAnswer.at(-1)
			]
		});
		const run = await runAgent({ ...options(), schema, resume: 'previous-thread' });
		const events = await collect(run.events);
		const actual = record();
		expect(actual.args.slice(0, 4)).toEqual(['--no-daemon', 'exec', 'resume', '--json']);
		expect(actual.args.slice(-2)).toEqual(['previous-thread', '-']);
		expect(actual.schema).toEqual(schema);
		expect(basename(actual.schemaPath!)).toBe('output-schema.json');
		expect(basename(dirname(actual.schemaPath!))).toBe(basename(actual.cwd));
		expect(existsSync(actual.schemaPath!)).toBe(false);
		expect(events.at(-1)).toMatchObject({
			type: 'result',
			structured: { title: 'A guide' },
			error: undefined
		});
	});

	test('separates live deltas from completed reasoning, tools and answer without repeats', async () => {
		stub({
			events: [
				'not JSON',
				'null',
				{ type: 'thread.started', thread_id: 'session' },
				{ type: 'item.updated', item: { id: 'r', type: 'reasoning', text: 'Look' } },
				{ type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'Looking closely.' } },
				{
					type: 'item.completed',
					item: { id: 'before', type: 'agent_message', text: 'Let me read.' }
				},
				{
					type: 'item.started',
					item: { id: 'tool', type: 'command_execution', command: 'cat src/a.ts' }
				},
				{
					type: 'item.completed',
					item: { id: 'tool', type: 'command_execution', command: 'cat src/a.ts' }
				},
				{ type: 'item.updated', item: { id: 'a', type: 'agent_message', text: 'The ' } },
				{ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'The answer.' } },
				{ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'The answer.' } },
				{ type: 'turn.completed' }
			]
		});
		const run = await runAgent(options());
		const events = await collect(run.events);
		expect(events.filter((event) => event.type === 'delta')).toEqual([
			{ type: 'delta', channel: 'thinking', text: 'Look' },
			{ type: 'delta', channel: 'thinking', text: 'ing closely.' },
			{ type: 'delta', channel: 'text', text: 'Let me read.' },
			{ type: 'delta', channel: 'text', text: 'The ' },
			{ type: 'delta', channel: 'text', text: 'answer.' }
		]);
		expect(events.filter((event) => event.type === 'content')).toEqual([
			{ type: 'content', blocks: [{ type: 'thinking', text: 'Looking closely.' }] },
			{ type: 'content', blocks: [{ type: 'text', text: 'Let me read.' }] },
			{ type: 'content', blocks: [{ type: 'tool', text: 'Running cat src/a.ts' }] },
			{ type: 'content', blocks: [{ type: 'text', text: 'The answer.' }] }
		]);
		expect(events.at(-1)).toMatchObject({ type: 'result', text: 'The answer.' });
	});

	test('uses the final agent message for structured output after commentary without tools', async () => {
		stub({
			events: [
				{ type: 'thread.started', thread_id: 'session' },
				{
					type: 'item.completed',
					item: { id: 'comment', type: 'agent_message', text: 'Here is the explanation.' }
				},
				{
					type: 'item.completed',
					item: { id: 'final', type: 'agent_message', text: '{"title":"The explanation"}' }
				},
				{ type: 'turn.completed' }
			]
		});
		const run = await runAgent({ ...options(), schema });
		const events = await collect(run.events);
		expect(events.at(-1)).toMatchObject({
			type: 'result',
			text: '{"title":"The explanation"}',
			structured: { title: 'The explanation' },
			error: undefined
		});
		expect(events).toContainEqual({
			type: 'content',
			blocks: [{ type: 'text', text: 'Here is the explanation.' }]
		});
	});

	test('accepts a successful turn after recovering from a transport diagnostic', async () => {
		stub({
			events: [{ type: 'error', message: 'Reconnecting... 1/5' }, ...codexAnswer]
		});
		const run = await runAgent(options());
		expect((await collect(run.events)).at(-1)).toMatchObject({
			type: 'result',
			text: 'The answer.',
			error: undefined
		});
	});

	test.each([
		{
			name: 'failed turns',
			spec: { events: [{ type: 'turn.failed', error: { message: 'Session not found' } }] },
			error: 'Session not found'
		},
		{
			name: 'protocol errors',
			spec: { events: [{ type: 'error', message: 'Authentication failed' }] },
			error: 'Authentication failed'
		},
		{
			name: 'nonzero exits after output',
			spec: { events: codexAnswer, exitCode: 1, stderr: 'The CLI failed' },
			error: 'The CLI failed'
		},
		{
			name: 'missing final output',
			spec: { events: [{ type: 'turn.completed' }] },
			error: 'Codex stopped without a final response'
		}
	])('reports $name as errors', async ({ spec, error }) => {
		stub(spec);
		const run = await runAgent(options());
		expect((await collect(run.events)).at(-1)).toMatchObject({ type: 'result', error });
		expect(existsSync(record().cwd)).toBe(false);
	});

	test('rejects invalid structured output instead of treating it as successful', async () => {
		stub({ events: codexAnswer });
		const run = await runAgent({ ...options(), schema });
		expect((await collect(run.events)).at(-1)).toMatchObject({
			type: 'result',
			error: 'Codex returned an invalid structured response'
		});
	});

	test('reports spawn failures and cleans up without throwing from stdin', async () => {
		privateEnv.CODEX_BIN = join(directory, 'missing-binary');
		const opts = options();
		const run = await runAgent({ ...opts, input: 'x'.repeat(1_000_000), schema });
		const events = await collect(run.events);
		expect(await run.exited).toBe(null);
		expect(opts.onSpawnError).toHaveBeenCalledOnce();
		expect(events.at(-1)).toMatchObject({
			type: 'result',
			error: expect.stringContaining('exited')
		});
	});

	test('handles an early process exit and a large stdin prompt without an unhandled EPIPE', async () => {
		stub({ quitBeforeInput: true, exitCode: 2 });
		const run = await runAgent({ ...options(), input: 'x'.repeat(1_000_000), schema });
		expect((await collect(run.events)).at(-1)).toMatchObject({
			type: 'result',
			error: expect.stringContaining('code 2')
		});
		expect(existsSync(record().cwd)).toBe(false);
	});

	test('cancels a running process and removes its schema directory', async () => {
		stub({ hang: true });
		const controller = new AbortController();
		const run = await runAgent({ ...options(), schema, signal: controller.signal });
		const events = collect(run.events);
		await vi.waitFor(() => expect(existsSync(recordPath)).toBe(true));
		const actual = record();
		controller.abort();
		expect(await events).toEqual([]);
		await run.exited;
		expect(existsSync(actual.cwd)).toBe(false);
	});

	test('does not spawn after cancellation during asynchronous setup', async () => {
		const controller = new AbortController();
		const result = runAgent({ ...options(), schema, signal: controller.signal });
		controller.abort(new Error('Stopped'));
		await expect(result).rejects.toThrow('Stopped');
		expect(existsSync(recordPath)).toBe(false);
	});

	test('stopping iteration also terminates the child and removes temporary files', async () => {
		stub({ events: codexAnswer });
		const run = await runAgent({ ...options(), schema });
		for await (const event of run.events) {
			expect(event.type).toBe('init');
			break;
		}
		await run.exited;
		expect(existsSync(record().cwd)).toBe(false);
	});
});

describe('Claude adapter', () => {
	test('preserves CLI restrictions and maps partial messages, content and usage separately', async () => {
		stub({
			events: [
				{ type: 'system', subtype: 'init', session_id: 'claude-session', model: 'claude-model' },
				{ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 12 },
				{
					type: 'stream_event',
					event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Hmm' } }
				},
				{
					type: 'stream_event',
					event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' } }
				},
				{
					type: 'assistant',
					message: {
						content: [
							{ type: 'thinking', thinking: 'Hmm.' },
							{ type: 'text', text: 'Answer.' },
							{ type: 'tool_use', name: 'Read', input: { file_path: join(options().root, 'a.ts') } }
						],
						usage: {
							input_tokens: 10,
							cache_read_input_tokens: 20,
							cache_creation_input_tokens: 5,
							output_tokens: 3
						}
					}
				},
				{
					type: 'result',
					result: 'Answer.',
					structured_output: { title: 'A guide' },
					session_id: 'claude-session',
					total_cost_usd: 0.12,
					usage: { output_tokens_details: { thinking_tokens: 42 } }
				}
			]
		});
		const run = await runAgent({
			...options(),
			provider: 'claude',
			system: 'Answer carefully.',
			dirs: ['/extra/context'],
			model: 'claude-model',
			resume: 'previous-session',
			thinking: true,
			schema
		});
		const events = await collect(run.events);
		await run.exited;
		const actual = record();
		expect(actual.cwd).toBe(directory);
		expect(actual.extraDirectories).toBe('1');
		expect(actual.args).toEqual(
			expect.arrayContaining([
				'--include-partial-messages',
				'--add-dir',
				options().root,
				'/extra/context',
				'--tools',
				'Read,Grep,Glob',
				'--allowedTools',
				'--strict-mcp-config',
				'--setting-sources',
				'project',
				'--append-system-prompt',
				'Answer carefully.',
				'--thinking-display',
				'summarized',
				'--resume',
				'previous-session',
				'--json-schema',
				JSON.stringify(schema)
			])
		);
		expect(events).toEqual([
			{ type: 'init', sessionId: 'claude-session', model: 'claude-model' },
			{ type: 'thinking_tokens', tokens: 12 },
			{ type: 'delta', channel: 'thinking', text: 'Hmm' },
			{ type: 'delta', channel: 'text', text: 'Answer' },
			{
				type: 'content',
				blocks: [
					{ type: 'thinking', text: 'Hmm.' },
					{ type: 'text', text: 'Answer.' },
					{ type: 'tool', text: 'Reading a.ts' }
				],
				contextTokens: 38
			},
			{
				type: 'result',
				text: 'Answer.',
				structured: { title: 'A guide' },
				sessionId: 'claude-session',
				sessionCost: 0.12,
				thinkingTokens: 42,
				contextTokens: undefined,
				error: undefined
			}
		]);
	});

	test('preserves Claude error results', async () => {
		stub({ events: [{ type: 'result', subtype: 'error', is_error: true, result: 'No session' }] });
		const run = await runAgent({ ...options(), provider: 'claude' });
		expect((await collect(run.events)).at(-1)).toMatchObject({
			type: 'result',
			error: 'No session'
		});
		await run.exited;
	});
});
