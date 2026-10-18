import { providerLabel, type AgentProvider } from '$lib/agent';
import { parseDiff } from '$lib/diff/parse';
import type { DiffFile } from '$lib/diff/types';
import type { Guide, GuideDraft, GuideEvent } from '$lib/guide/types';
import { prContextOf } from './ask';
import { runAgent } from './agent';
import { defaultProvider, modelFor } from './provider';
import { checkPrNumber } from './gh';
import { commitLog, readDiff } from './git';
import { reconcile, saveGuide } from './guides';
import { jobQueue, type Job } from './jobs';
import { hunkText } from './threads';

/** The structured output the agent must return. */
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
					kind: { type: 'string', enum: ['core', 'supporting', 'chore'] },
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

// Beyond this the hunk bodies are shortened and the agent reads the rest itself.
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
	pr?: number,
	provider: AgentProvider = defaultProvider()
): Job<GuideEvent> {
	return jobs.start(jobKey(root, start, stop), (job) => run(job, root, start, stop, pr, provider));
}

async function run(
	job: Job<GuideEvent>,
	root: string,
	start: string,
	stop: string,
	pr: number | undefined,
	provider: AgentProvider
) {
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

	const label = providerLabel(provider);
	const selectedModel = modelFor(provider, 'guide');
	const agent = await runAgent({
		provider,
		root,
		input: prompt(start, stop, log, files, context),
		cwd: root,
		schema: GUIDE_SCHEMA,
		model: selectedModel,
		signal: job.stop.signal,
		onSpawnError: (error) =>
			jobs.emit(job, { type: 'error', message: `Couldn't start ${label}: ${error.message}` })
	});
	const child = agent.child;
	job.child = child;
	if (job.finished) {
		child.kill();
		return;
	}

	jobs.emit(job, { type: 'status', text: `Starting ${label}` });
	let model = selectedModel || 'default';

	for await (const event of agent.events) {
		if (job.finished) return;
		if (event.type === 'init') {
			model = event.model ?? model;
			jobs.emit(job, { type: 'status', text: `${label} is reviewing the change (${model})` });
		} else if (event.type === 'content') {
			for (const block of event.blocks) {
				if (block.type === 'tool') jobs.emit(job, { type: 'tool', text: block.text });
			}
		} else if (event.type === 'result') {
			const draft = event.structured as GuideDraft | undefined;
			if (event.error || !draft) {
				throw new Error(event.error || `${label} stopped without a guide`);
			}
			jobs.emit(job, { type: 'status', text: 'Writing the guide' });
			const guide: Guide = {
				version: 1,
				repo: root,
				start,
				stop,
				createdAt: new Date().toISOString(),
				model,
				provider,
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

	const code = await agent.exited;
	if (!job.finished) {
		throw new Error(agent.stderr().trim() || `${label} exited with code ${code} before finishing`);
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
