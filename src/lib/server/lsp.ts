import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { log, logged } from './log';

/**
 * Just enough of a language server client to ask one where a symbol is used:
 * JSON-RPC over the server's stdio, each message after a Content-Length header.
 */
export interface Lsp {
	child: ChildProcess;
	request<T>(method: string, params: unknown): Promise<T>;
	notify(method: string, params: unknown): void;
	/**
	 * Resolves once the work the server reports, like indexing, is done: after
	 * `graceMs` for it to start, at the latest after `timeoutMs`. Says whether it finished.
	 */
	settled(graceMs: number, timeoutMs: number): Promise<boolean>;
	/** Asks the server to exit, and makes sure it does. */
	close(): Promise<void>;
}

/** What the server says it's working on: a title, and how far along it is. */
export type Progress = { title: string; message?: string; percentage?: number };

const HEADER_END = '\r\n\r\n';

export function startLsp(options: {
	command: string;
	args: string[];
	cwd: string;
	/** the workspace folder, for servers that ask for it */
	root: string;
	onProgress?: (progress: Progress) => void;
}): Lsp {
	const name = options.command.split('/').pop()!;
	log('lsp', `starting ${[options.command, ...options.args].join(' ')} in ${options.cwd}`);
	const child = spawn(options.command, options.args, {
		cwd: options.cwd,
		stdio: ['pipe', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
	// a server that exits before reading everything would otherwise throw EPIPE
	child.stdin.on('error', () => {});

	let nextId = 1;
	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	let exited: Error | null = null;

	/** what the server reported as begun and not yet ended, by token */
	const working = new Map<string | number, string>();
	let idle: (() => void) | null = null;

	const send = (message: object) => {
		const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
		child.stdin.write(`Content-Length: ${body.length}${HEADER_END}`);
		child.stdin.write(body);
	};

	function onMessage(message: {
		id?: number | string;
		method?: string;
		params?: { token?: string | number; value?: Record<string, unknown> };
		result?: unknown;
		error?: { message: string };
	}) {
		if (message.method && message.id !== undefined) {
			// requests from the server: answered as plainly as possible
			send({ id: message.id, result: answerServer(message.method, message.params, options.root) });
		} else if (message.method === '$/progress' && message.params?.value) {
			const { token, value } = message.params as {
				token: string | number;
				value: { kind: string; title?: string; message?: string; percentage?: number };
			};
			if (value.kind === 'begin') {
				working.set(token, value.title ?? '');
				log('lsp', `${name}: ${value.title ?? 'working'}…`);
			}
			const title = working.get(token) ?? '';
			if (value.kind === 'end') {
				log('lsp', `${name}: ${title || 'work'} done`);
				working.delete(token);
				if (working.size === 0) idle?.();
			} else {
				options.onProgress?.({ title, message: value.message, percentage: value.percentage });
			}
		} else if (message.id !== undefined && !message.method) {
			const waiting = pending.get(Number(message.id));
			pending.delete(Number(message.id));
			if (message.error) waiting?.reject(new Error(message.error.message));
			else waiting?.resolve(message.result);
		}
	}

	let buffer = Buffer.alloc(0);
	child.stdout.on('data', (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			const end = buffer.indexOf(HEADER_END);
			if (end < 0) return;
			const length = Number(
				/Content-Length: *(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1]
			);
			const start = end + HEADER_END.length;
			if (!Number.isFinite(length)) {
				// not a message's header: skipped, it would otherwise be read again forever
				buffer = buffer.subarray(start);
				continue;
			}
			if (buffer.length < start + length) return;
			const body = buffer.subarray(start, start + length).toString();
			buffer = buffer.subarray(start + length);
			try {
				onMessage(JSON.parse(body));
			} catch {
				// a message we can't read is one we didn't need
			}
		}
	});

	const fail = (error: Error) => {
		exited ??= error;
		for (const waiting of pending.values()) waiting.reject(exited);
		pending.clear();
		idle?.();
	};
	child.on('error', (error) =>
		fail(new Error(`Couldn't start ${options.command}: ${error.message}`))
	);
	child.on('close', (code) => {
		log('lsp', `${name} exited with code ${code}`);
		fail(new Error(`${options.command} exited with code ${code}${stderr && `: ${stderr.trim()}`}`));
	});

	return {
		child,
		request<T>(method: string, params: unknown) {
			if (exited) return Promise.reject(exited);
			const id = nextId++;
			const where = (params as { textDocument?: { uri?: string } })?.textDocument?.uri;
			return logged(
				'lsp',
				`${name}: ${method}${where ? ` ${where.split('/').pop()}` : ''}`,
				new Promise<T>((resolve, reject) => {
					pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
					send({ id, method, params });
				})
			);
		},
		notify(method, params) {
			if (!exited) send({ method, params });
		},
		async settled(graceMs, timeoutMs) {
			// ponytail: work that starts after the grace period isn't waited for
			await new Promise((resolve) => setTimeout(resolve, graceMs));
			if (working.size === 0 || exited) return true;
			let timer: NodeJS.Timeout | undefined;
			const done = await Promise.race([
				new Promise<boolean>((resolve) => (idle = () => resolve(true))),
				new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)))
			]);
			clearTimeout(timer);
			idle = null;
			return done;
		},
		async close() {
			if (!exited) {
				const shutdown = this.request('shutdown', null).catch(() => {});
				let timer: NodeJS.Timeout | undefined;
				await Promise.race([
					shutdown,
					new Promise((resolve) => (timer = setTimeout(resolve, 2000)))
				]);
				clearTimeout(timer);
				this.notify('exit', null);
			}
			child.kill();
		}
	};
}

function answerServer(method: string, params: unknown, root: string): unknown {
	switch (method) {
		case 'workspace/configuration':
			// every setting at its default
			return ((params as { items?: unknown[] })?.items ?? []).map(() => ({}));
		case 'workspace/workspaceFolders':
			return [{ uri: pathToFileURL(root).href, name: 'root' }];
		default:
			// window/workDoneProgress/create, client/registerCapability and the like
			return null;
	}
}
