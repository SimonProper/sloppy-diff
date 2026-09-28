import { spawn, type ChildProcess } from 'node:child_process';
import { relative } from 'node:path';
import { createInterface } from 'node:readline';
import { env } from '$env/dynamic/private';
import { parseDiff } from '$lib/diff/parse';
import type { DiffFile } from '$lib/diff/types';
import type { Guide, GuideDraft, GuideEvent } from '$lib/guide/types';
import { commitLog, errorMessage, readDiff } from './git';
import { reconcile, saveGuide } from './guides';

/** The structured output Claude must return. */
const GUIDE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['title', 'summary', 'sections'],
	properties: {
		title: { type: 'string', description: 'Short title for the whole change' },
		summary: { type: 'string', description: 'Markdown, 2-4 sentences on what the change does' },
		sections: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['title', 'kind', 'rationale', 'commits', 'hunks', 'notes'],
				properties: {
					title: { type: 'string' },
					kind: { enum: ['core', 'supporting', 'chore'] },
					rationale: { type: 'string', description: 'Markdown: why this part exists' },
					commits: { type: 'array', items: { type: 'string' } },
					hunks: { type: 'array', items: { type: 'string' }, minItems: 1 },
					notes: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['hunk', 'text'],
							properties: { hunk: { type: 'string' }, text: { type: 'string' } }
						}
					}
				}
			}
		}
	}
};

// read-only: Claude may look around the repo for context but never change it. No git
// through Bash, flags like `git grep -O<cmd>` or `--output=<file>` run commands or write
// files, and the diff it reviews may carry instructions written to make it try
const ALLOWED_TOOLS = 'Read,Grep,Glob';
const DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch';

// beyond this the hunk bodies are shortened and Claude reads the rest itself
const MAX_DIFF_CHARS = 400_000;
const SHORT_HUNK_LINES = 30;

interface Job {
	key: string;
	events: GuideEvent[];
	listeners: Set<(event: GuideEvent) => void>;
	finished: boolean;
	child?: ChildProcess;
}

// kept on globalThis so a dev server module reload doesn't orphan running jobs
const store = globalThis as { __guideJobs?: Map<string, Job> };
const jobs = (store.__guideJobs ??= new Map<string, Job>());

const jobKey = (root: string, start: string, stop: string) => `${root}\0${start}..${stop}`;

export function getJob(root: string, start: string, stop: string): Job | undefined {
	return jobs.get(jobKey(root, start, stop));
}

export function cancelJob(root: string, start: string, stop: string) {
	const job = getJob(root, start, stop);
	if (job && !job.finished) {
		job.child?.kill();
		emit(job, { type: 'error', message: 'Cancelled' });
	}
}

/** How long a finished job's events stay around for a page that reconnects. */
const KEEP_FINISHED_MS = 5 * 60_000;

function emit(job: Job, event: GuideEvent) {
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

/** Starts generating a guide for start..stop (resolved shas), or joins the running job. */
export function startGuide(root: string, start: string, stop: string): Job {
	const key = jobKey(root, start, stop);
	const running = jobs.get(key);
	if (running && !running.finished) return running;

	const job: Job = { key, events: [], listeners: new Set(), finished: false };
	jobs.set(key, job);
	run(job, root, start, stop).catch((error) => {
		job.child?.kill();
		emit(job, { type: 'error', message: errorMessage(error) });
	});
	return job;
}

async function run(job: Job, root: string, start: string, stop: string) {
	emit(job, { type: 'status', text: 'Reading commits and diff' });
	const [log, patch] = await Promise.all([
		commitLog(root, start, stop),
		readDiff(root, start, stop)
	]);
	// cancelled while reading
	if (job.finished) return;
	const files = parseDiff(patch);
	if (files.every((f) => f.hunks.length === 0)) {
		throw new Error('There are no content changes to guide in this range.');
	}

	const args = [
		'-p',
		'--verbose',
		'--output-format',
		'stream-json',
		'--json-schema',
		JSON.stringify(GUIDE_SCHEMA),
		'--allowedTools',
		ALLOWED_TOOLS,
		'--disallowedTools',
		DISALLOWED_TOOLS
	];
	if (env.GUIDE_MODEL) args.push('--model', env.GUIDE_MODEL);

	const child = spawn(env.CLAUDE_BIN || 'claude', args, {
		cwd: root,
		stdio: ['pipe', 'pipe', 'pipe']
	});
	job.child = child;
	// claude exiting before it reads everything (a bad flag, not signed in) would
	// otherwise throw EPIPE and take the server down, the exit is reported below
	child.stdin.on('error', () => {});
	child.stdin.end(prompt(start, stop, log, files));

	let stderr = '';
	child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
	child.on('error', (error) =>
		emit(job, { type: 'error', message: `Couldn't start claude: ${error.message}` })
	);

	emit(job, { type: 'status', text: 'Starting Claude Code' });
	let model = env.GUIDE_MODEL || 'default';

	for await (const line of createInterface({ input: child.stdout })) {
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			continue;
		}

		if (message.type === 'system' && message.subtype === 'init') {
			model = message.model ?? model;
			emit(job, { type: 'status', text: `Claude is reviewing the change (${model})` });
		} else if (message.type === 'assistant') {
			for (const block of message.message?.content ?? []) {
				if (block.type !== 'tool_use') continue;
				if (block.name === 'StructuredOutput') {
					emit(job, { type: 'status', text: 'Writing the guide' });
				} else {
					emit(job, { type: 'tool', text: describeTool(block.name, block.input, root) });
				}
			}
		} else if (message.type === 'result') {
			const draft: GuideDraft | undefined = message.structured_output;
			if (message.is_error || !draft) {
				throw new Error(message.result || `Claude stopped without a guide (${message.subtype})`);
			}
			const guide: Guide = {
				version: 1,
				repo: root,
				start,
				stop,
				createdAt: new Date().toISOString(),
				model,
				title: draft.title,
				summary: draft.summary,
				sections: reconcile(draft, files)
			};
			await saveGuide(guide);
			emit(job, { type: 'done', start, stop });
			// the result is all we need, don't wait on hooks or anything else keeping claude alive
			child.kill();
			return;
		}
	}

	const code = await new Promise<number | null>((resolve) => {
		if (child.exitCode !== null) resolve(child.exitCode);
		child.on('close', resolve);
		child.on('error', () => resolve(null));
	});
	if (!job.finished) {
		throw new Error(stderr.trim() || `claude exited with code ${code} before finishing`);
	}
}

function describeTool(name: string, input: Record<string, string> = {}, root: string): string {
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

function prompt(start: string, stop: string, log: string, files: DiffFile[]): string {
	return `You are preparing a guided code review of the changes between commit ${start} and commit ${stop} in this repository. A reviewer will read your guide section by section instead of going through the diff file by file.

<commits>
${log.trim()}
</commits>

The diff between the two commits. Every hunk starts with its id in square brackets:

<diff>
${renderDiff(files)}
</diff>

Split the change into sections a reviewer should read in order.

- Group hunks by purpose: one concept, behaviour or refactor per section, even when it spans several files. Treat commits as hints, not structure: fold fixup and follow-up commits into the section they belong to, and split a commit that does several unrelated things.
- Order sections so the core of the change comes first (the hunks that implement the new behaviour), then supporting changes (types, plumbing, call sites, tests), then chores (formatting, renames, config, dependency and lockfile updates, generated files). Set \`kind\` to core, supporting or chore to match.
- Give each section a short title and a rationale in markdown, one to four sentences, explaining why this part exists and what a reviewer should pay attention to. Don't narrate the diff line by line.
- Every hunk id must appear in exactly one section. Use only ids that appear in the diff. Within a section, list hunks in the order they should be read.
- \`notes\` are optional callouts on specific hunks: something subtle, risky, or worth a closer look. Use them sparingly and leave the array empty when there is nothing to flag.
- \`commits\` lists the short shas of the commits that contributed to each section.
- \`title\` names the whole change; \`summary\` is two to four sentences of markdown on what it does and why.

You may read, search and list files in the repository to understand the surrounding code. Don't modify anything.`;
}

function renderDiff(files: DiffFile[]): string {
	const full = files.map((f) => renderFile(f, Infinity)).join('\n\n');
	if (full.length <= MAX_DIFF_CHARS) return full;
	return files.map((f) => renderFile(f, SHORT_HUNK_LINES)).join('\n\n');
}

function renderFile(file: DiffFile, maxLines: number): string {
	const path = file.oldPath !== file.newPath ? `${file.oldPath} → ${file.newPath}` : file.newPath;
	const head = `### ${path} (${file.status})`;
	if (file.binary) return `${head}\nbinary file`;
	const hunks = file.hunks.map((hunk) => {
		const body = hunk.lines
			.slice(0, maxLines)
			.map((l) => (l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ') + l.text);
		if (hunk.lines.length > maxLines) {
			body.push(`… ${hunk.lines.length - maxLines} more lines, read the file to see them`);
		}
		return `[${hunk.id}] ${hunk.header}\n${body.join('\n')}`;
	});
	return [head, ...hunks].join('\n');
}
