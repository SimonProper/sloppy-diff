import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { env } from '$env/dynamic/private';
import type { AgentProvider } from '$lib/agent';
import { describeTool, runClaude, type ClaudeMessage } from './claude';

type ContentBlock = { type: 'thinking' | 'text' | 'tool'; text: string };

/** The two CLIs have different wire protocols; callers consume this common stream. */
export type AgentEvent =
	| { type: 'init'; sessionId?: string; model?: string }
	| { type: 'delta'; channel: 'thinking' | 'text'; text: string }
	| { type: 'thinking_tokens'; tokens: number }
	| { type: 'content'; blocks: ContentBlock[]; contextTokens?: number }
	| {
			type: 'result';
			text?: string;
			structured?: unknown;
			sessionId?: string;
			sessionCost?: number;
			turnCost?: number;
			thinkingTokens?: number;
			contextTokens?: number;
			error?: string;
	  };

export interface AgentRun {
	child: ChildProcess;
	events: AsyncIterable<AgentEvent>;
	stderr: () => string;
	exited: Promise<number | null>;
}

interface AgentOptions {
	provider: AgentProvider;
	cwd: string;
	root: string;
	dirs?: string[];
	input: string;
	system?: string;
	model?: string;
	resume?: string;
	schema?: Record<string, unknown>;
	thinking?: boolean;
	signal?: AbortSignal;
	onSpawnError: (error: Error) => void;
}

function checkCancelled(signal?: AbortSignal) {
	if (signal?.aborted) throw signal.reason ?? new Error('Generation cancelled');
}

function cancelOnAbort(child: ChildProcess, signal?: AbortSignal) {
	const cancel = () => child.kill();
	signal?.addEventListener('abort', cancel, { once: true });
	child.once('close', () => signal?.removeEventListener('abort', cancel));
	// The signal may have fired while asynchronous setup was finishing.
	if (signal?.aborted) cancel();
}

/** Start a read-only CLI run. Codex's temporary cwd also isolates project configuration. */
export async function runAgent(options: AgentOptions): Promise<AgentRun> {
	checkCancelled(options.signal);
	if (options.provider === 'codex') return runCodex(options);
	const tools = 'Read,Grep,Glob';
	const args = [
		'-p',
		'--verbose',
		'--output-format',
		'stream-json',
		'--include-partial-messages',
		...Array.from(new Set([options.root, ...(options.dirs ?? [])])).flatMap((dir) => [
			'--add-dir',
			dir
		]),
		'--tools',
		tools,
		'--allowedTools',
		tools,
		'--disallowedTools',
		'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch',
		'--strict-mcp-config',
		'--setting-sources',
		'project'
	];
	if (options.system) args.push('--append-system-prompt', options.system);
	if (options.thinking) args.push('--thinking-display', 'summarized');
	if (options.model) args.push('--model', options.model);
	if (options.resume) args.push('--resume', options.resume);
	if (options.schema) args.push('--json-schema', JSON.stringify(options.schema));
	const run = runClaude({
		args,
		input: options.input,
		cwd: options.cwd,
		env: { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' },
		onSpawnError: options.onSpawnError
	});
	cancelOnAbort(run.child, options.signal);
	return {
		child: run.child,
		events: claudeEvents(run.messages, options.root),
		stderr: run.stderr,
		exited: run.exited
	};
}

function claudeTokens(usage: ClaudeMessage | undefined): number | undefined {
	if (!usage) return undefined;
	if (
		![
			'input_tokens',
			'cache_read_input_tokens',
			'cache_creation_input_tokens',
			'output_tokens'
		].some((key) => typeof usage[key] === 'number')
	) {
		return undefined;
	}
	return (
		(usage.input_tokens ?? 0) +
		(usage.cache_read_input_tokens ?? 0) +
		(usage.cache_creation_input_tokens ?? 0) +
		(usage.output_tokens ?? 0)
	);
}

async function* claudeEvents(
	messages: AsyncIterable<ClaudeMessage>,
	root: string
): AsyncIterable<AgentEvent> {
	for await (const message of messages) {
		if (message.type === 'system' && message.subtype === 'init') {
			yield { type: 'init', sessionId: message.session_id, model: message.model };
		} else if (message.type === 'system' && message.subtype === 'thinking_tokens') {
			yield { type: 'thinking_tokens', tokens: message.estimated_tokens ?? 0 };
		} else if (message.type === 'stream_event') {
			const delta = message.event?.type === 'content_block_delta' ? message.event.delta : null;
			if (delta?.type === 'thinking_delta' && delta.thinking) {
				yield { type: 'delta', channel: 'thinking', text: delta.thinking };
			} else if (delta?.type === 'text_delta' && delta.text) {
				yield { type: 'delta', channel: 'text', text: delta.text };
			}
		} else if (message.type === 'assistant') {
			const blocks: ContentBlock[] = [];
			for (const block of message.message?.content ?? []) {
				if (block.type === 'thinking' && block.thinking) {
					blocks.push({ type: 'thinking', text: block.thinking });
				} else if (block.type === 'text' && block.text) {
					blocks.push({ type: 'text', text: block.text });
				} else if (block.type === 'tool_use') {
					blocks.push({ type: 'tool', text: describeTool(block.name, block.input, root) });
				}
			}
			yield {
				type: 'content',
				blocks,
				contextTokens: claudeTokens(message.message?.usage)
			};
		} else if (message.type === 'result') {
			yield {
				type: 'result',
				text: typeof message.result === 'string' ? message.result : undefined,
				structured: message.structured_output,
				sessionId: message.session_id,
				sessionCost: message.total_cost_usd,
				thinkingTokens: message.usage?.output_tokens_details?.thinking_tokens,
				contextTokens: claudeTokens(message.usage),
				error: message.is_error
					? String(message.result || `Claude stopped (${message.subtype})`)
					: undefined
			};
		}
	}
}

async function runCodex(options: AgentOptions): Promise<AgentRun> {
	const directory = await mkdtemp(join(tmpdir(), 'sloppy-diff-codex-'));
	let child: ChildProcess;
	try {
		const args = [
			'--no-daemon',
			'exec',
			...(options.resume ? ['resume'] : []),
			'--json',
			'--skip-git-repo-check',
			'--ignore-user-config',
			'--ignore-rules',
			'-c',
			'sandbox_mode="read-only"',
			'-c',
			'approval_policy="never"',
			'-c',
			'sandbox_workspace_write.network_access=false',
			'-c',
			'web_search="disabled"',
			'-c',
			'mcp_servers={}',
			'--disable',
			'apps',
			'--disable',
			'hooks',
			'--disable',
			'plugins'
		];
		if (options.model) args.push('--model', options.model);
		if (options.schema) {
			const schemaPath = join(directory, 'output-schema.json');
			await writeFile(schemaPath, JSON.stringify(options.schema), { flag: 'wx' });
			args.push('--output-schema', schemaPath);
		}
		if (options.resume) args.push(options.resume);
		args.push('-');
		checkCancelled(options.signal);
		child = spawn(env.CODEX_BIN || 'codex', args, {
			// Never load .codex configuration, hooks or plugins from the repository being reviewed.
			cwd: directory,
			env: process.env,
			stdio: ['pipe', 'pipe', 'pipe']
		});
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
	const cleanup = () => rm(directory, { recursive: true, force: true }).catch(() => {});
	let stderr = '';
	child.stderr!.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
	child.stdin!.on('error', () => {});
	child.on('error', options.onSpawnError);
	const exited = new Promise<number | null>((resolve) => {
		child.once('close', (code) => void cleanup().then(() => resolve(code)));
		child.once('error', () => void cleanup().then(() => resolve(null)));
	});
	cancelOnAbort(child, options.signal);
	const directories = Array.from(new Set([options.root, options.cwd, ...(options.dirs ?? [])]));
	child.stdin!.end(
		[
			options.system,
			`You are reviewing source code read-only. The repository is ${JSON.stringify(options.root)}. Read source and context from these absolute directories as needed: ${directories.map((dir) => JSON.stringify(dir)).join(', ')}. Do not modify files, execute project scripts, access the network, or use external services.`,
			options.input
		]
			.filter(Boolean)
			.join('\n\n')
	);
	return {
		child,
		events: codexEvents(child, exited, () => stderr, options),
		stderr: () => stderr,
		exited
	};
}

type CodexItem = {
	id?: string;
	type?: string;
	text?: string;
	command?: string;
	server?: string;
	tool?: string;
};

function errorText(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object' && 'message' in value) return String(value.message);
	return undefined;
}

async function* codexEvents(
	child: ChildProcess,
	exited: Promise<number | null>,
	stderr: () => string,
	options: AgentOptions
): AsyncIterable<AgentEvent> {
	let sessionId: string | undefined;
	let failure: string | undefined;
	let diagnostic: string | undefined;
	let completed = false;
	let contextTokens: number | undefined;
	let finalText = '';
	const streamed = new Map<string, string>();
	const finished = new Set<string>();
	const tools = new Set<string>();
	const lines = createInterface({ input: child.stdout! });
	try {
		for await (const line of lines) {
			let event: {
				type?: string;
				thread_id?: string;
				item?: CodexItem;
				error?: unknown;
				message?: string;
				usage?: { input_tokens?: number; output_tokens?: number };
			};
			try {
				event = JSON.parse(line);
				if (!event || typeof event !== 'object') continue;
			} catch {
				continue;
			}
			if (event.type === 'thread.started') {
				sessionId = event.thread_id;
				yield { type: 'init', sessionId, model: options.model };
			} else if (event.type === 'turn.failed') {
				failure = errorText(event.error) || event.message || 'Codex could not complete the turn';
			} else if (event.type === 'error') {
				// A transport diagnostic can precede a successful reconnect and completed turn.
				diagnostic = errorText(event.error) || event.message || 'Codex could not complete the turn';
			} else if (event.type === 'turn.completed') {
				completed = true;
				diagnostic = undefined;
				if (event.usage) {
					// cached_input_tokens is included in input_tokens, so do not count it twice.
					contextTokens = (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
				}
			} else if (event.type?.startsWith('item.') && event.item) {
				const item = event.item;
				const id = item.id ?? `${item.type}:${item.text ?? item.command ?? ''}`;
				if (item.type === 'reasoning' || item.type === 'agent_message') {
					if (typeof item.text !== 'string') continue;
					const channel = item.type === 'reasoning' ? 'thinking' : 'text';
					const previous = streamed.get(id) ?? '';
					const addition = item.text.startsWith(previous) ? item.text.slice(previous.length) : '';
					if (addition) yield { type: 'delta', channel, text: addition };
					streamed.set(id, item.text);
					if (event.type === 'item.completed' && !finished.has(id)) {
						finished.add(id);
						if (item.text) {
							yield { type: 'content', blocks: [{ type: channel, text: item.text }] };
							// Commentary and the final answer are separate agent messages. The schema
							// constrains only the last one, rather than their concatenation.
							if (channel === 'text') finalText = item.text;
						}
					}
				} else if (
					(item.type === 'command_execution' || item.type === 'mcp_tool_call') &&
					!tools.has(id)
				) {
					tools.add(id);
					finalText = '';
					const text =
						item.type === 'command_execution'
							? `Running ${item.command ?? 'read-only command'}`
							: `Using ${item.server ?? 'tool'}${item.tool ? `: ${item.tool}` : ''}`;
					yield { type: 'content', blocks: [{ type: 'tool', text }] };
				}
			}
		}
		const code = await exited;
		if (options.signal?.aborted) return;
		const text = finalText;
		if (!failure && code !== 0) {
			failure = diagnostic || stderr().trim() || `Codex exited with code ${code} before finishing`;
		}
		if (!failure && (!completed || !text.trim())) {
			failure = diagnostic || stderr().trim() || 'Codex stopped without a final response';
		}
		let structured: unknown;
		if (!failure && options.schema) {
			try {
				structured = JSON.parse(text);
			} catch {
				failure = 'Codex returned an invalid structured response';
			}
		}
		yield { type: 'result', text, structured, sessionId, contextTokens, error: failure };
	} finally {
		lines.close();
		// A caller stopping the stream early must not leak a process or its temporary schema.
		if (child.exitCode === null && child.signalCode === null) child.kill();
	}
}
