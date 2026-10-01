import { env } from '$env/dynamic/private';
import { parseDiff } from '$lib/diff/parse';
import type { DiffFile } from '$lib/diff/types';
import type { Guide, GuideDraft, GuideEvent } from '$lib/guide/types';
import { prContextOf } from './ask';
import { describeTool, runClaude } from './claude';
import { checkPrNumber } from './gh';
import { commitLog, readDiff } from './git';
import { reconcile, saveGuide } from './guides';
import { jobQueue, type Job } from './jobs';
import { hunkText } from './threads';

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

const jobs = jobQueue<GuideEvent>('guides');

const jobKey = (root: string, start: string, stop: string) => `${root}\0${start}..${stop}`;

export function getJob(root: string, start: string, stop: string): Job<GuideEvent> | undefined {
	return jobs.get(jobKey(root, start, stop));
}

export function cancelJob(root: string, start: string, stop: string) {
	jobs.cancel(jobKey(root, start, stop));
}

/**
 * Starts generating a guide for start..stop (resolved shas), or joins the running job.
 * `pr` is the pull request the range is, Claude reads its title and description too.
 */
export function startGuide(
	root: string,
	start: string,
	stop: string,
	pr?: number
): Job<GuideEvent> {
	return jobs.start(jobKey(root, start, stop), (job) => run(job, root, start, stop, pr));
}

async function run(job: Job<GuideEvent>, root: string, start: string, stop: string, pr?: number) {
	jobs.emit(job, { type: 'status', text: 'Reading commits and diff' });
	const [log, patch, context] = await Promise.all([
		commitLog(root, start, stop),
		readDiff(root, start, stop),
		pr === undefined ? '' : prContextOf(root, checkPrNumber(pr))
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

	const claude = runClaude({
		args,
		input: prompt(start, stop, log, files, context),
		cwd: root,
		onSpawnError: (error) =>
			jobs.emit(job, { type: 'error', message: `Couldn't start claude: ${error.message}` })
	});
	const child = claude.child;
	job.child = child;

	jobs.emit(job, { type: 'status', text: 'Starting Claude Code' });
	let model = env.GUIDE_MODEL || 'default';

	for await (const message of claude.messages) {
		if (message.type === 'system' && message.subtype === 'init') {
			model = message.model ?? model;
			jobs.emit(job, { type: 'status', text: `Claude is reviewing the change (${model})` });
		} else if (message.type === 'assistant') {
			for (const block of message.message?.content ?? []) {
				if (block.type !== 'tool_use') continue;
				if (block.name === 'StructuredOutput') {
					jobs.emit(job, { type: 'status', text: 'Writing the guide' });
				} else {
					jobs.emit(job, { type: 'tool', text: describeTool(block.name, block.input, root) });
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
			jobs.emit(job, { type: 'done', start, stop });
			// the result is all we need, don't wait on hooks or anything else keeping claude alive
			child.kill();
			return;
		}
	}

	const code = await claude.exited;
	if (!job.finished) {
		throw new Error(claude.stderr().trim() || `claude exited with code ${code} before finishing`);
	}
}

function prompt(start: string, stop: string, log: string, files: DiffFile[], pr: string): string {
	return `You are preparing a guided code review of the changes between commit ${start} and commit ${stop} in this repository. A reviewer will read your guide section by section instead of going through the diff file by file.
${pr && `\n${pr}\n\nWhere the change doesn't do what the description says, or does more than it says, point it out in the summary or in a note on the hunk.\n`}
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
	const hunks = file.hunks.map((hunk) => `[${hunk.id}] ${hunkText(hunk, maxLines)}`);
	return [head, ...hunks].join('\n');
}
