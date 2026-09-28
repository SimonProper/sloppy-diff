import { spawn, type ChildProcess } from 'node:child_process';
import { relative } from 'node:path';
import { createInterface } from 'node:readline';
import { env } from '$env/dynamic/private';

export interface ClaudeRun {
	child: ChildProcess;
	/** stream-json messages as they arrive, lines that aren't JSON are skipped */
	messages: AsyncIterable<ClaudeMessage>;
	/** the end of what claude wrote to stderr */
	stderr: () => string;
	/** the exit code, null when it couldn't start */
	exited: Promise<number | null>;
}

// the stream-json protocol isn't typed, the callers pick out the fields they know
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClaudeMessage = Record<string, any>;

/** Runs `claude` with `args`, the prompt goes in on stdin. */
export function runClaude(options: {
	args: string[];
	input: string;
	cwd: string;
	env?: Record<string, string>;
	onSpawnError: (error: Error) => void;
}): ClaudeRun {
	const child = spawn(env.CLAUDE_BIN || 'claude', options.args, {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		stdio: ['pipe', 'pipe', 'pipe']
	});
	// claude exiting before it reads everything (a bad flag, not signed in) would
	// otherwise throw EPIPE and take the server down, the exit is reported instead
	child.stdin.on('error', () => {});
	child.stdin.end(options.input);

	let stderr = '';
	child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
	child.on('error', options.onSpawnError);

	const exited = new Promise<number | null>((resolve) => {
		child.on('close', resolve);
		child.on('error', () => resolve(null));
	});

	async function* messages() {
		for await (const line of createInterface({ input: child.stdout })) {
			try {
				yield JSON.parse(line) as ClaudeMessage;
			} catch {
				continue;
			}
		}
	}

	return { child, messages: messages(), stderr: () => stderr, exited };
}

/** A tool call the way the progress list shows it, paths relative to the repo. */
export function describeTool(name: string, input: Record<string, string> = {}, root: string) {
	const path = (p?: string) => (p ? relative(root, p) || '.' : '');
	switch (name) {
		case 'Read':
			return `Reading ${path(input.file_path)}`;
		case 'Grep':
			return `Searching for ${input.pattern}`;
		case 'Glob':
			return `Looking for ${input.pattern}`;
		default:
			return name;
	}
}
