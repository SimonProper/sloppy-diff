import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import {
	cancelExplainerJob,
	getExplainerJob,
	loadExplainer,
	startExplainer
} from '$lib/server/explainers';
import { repoRoot, resolveCommit, resolveStart } from '$lib/server/git';
import { watchJob } from '$lib/server/jobs';
import { badRequestOnError } from '$lib/server/requests';
import { requestProvider } from '$lib/server/provider-request';
import { applyExplainerEvent, startExplainerProgress, type ExplainerRange } from './types';

async function resolveRange({ repo, start, stop }: ExplainerRange): Promise<ExplainerRange> {
	const root = await repoRoot(repo);
	const [from, to] = await Promise.all([resolveStart(root, start), resolveCommit(root, stop)]);
	return { repo: root, start: from, stop: to };
}

/** Read the saved document and discover a generation already running for this range. */
export const getExplainer = query('unchecked', (range: ExplainerRange) =>
	badRequestOnError(async () => {
		const resolved = await resolveRange(range);
		const explainer = await loadExplainer(resolved.repo, resolved.start, resolved.stop);
		const job = getExplainerJob(resolved.repo, resolved.start, resolved.stop);
		return { ...resolved, explainer, running: job !== undefined && !job.finished };
	})
);

export const generateExplainer = command(
	'unchecked',
	({ pr, focus, ...range }: ExplainerRange & { pr?: number; focus?: string }) =>
		badRequestOnError(async () => {
			const resolved = await resolveRange(range);
			startExplainer(resolved.repo, resolved.start, resolved.stop, pr, focus, requestProvider());
			return resolved;
		})
);

/** Follow a canonical range; `follow` gives each newly opened stream its own key. */
export const followExplainer = query.live(
	'unchecked',
	async function* ({ repo, start, stop }: ExplainerRange & { follow: string }) {
		const job = getExplainerJob(repo, start, stop);
		if (!job) error(404, 'No visual explainer is being generated for this range');
		yield* watchJob(
			job,
			applyExplainerEvent,
			startExplainerProgress(),
			getRequestEvent().request.signal
		);
	}
);

export const cancelExplainer = command('unchecked', ({ repo, start, stop }: ExplainerRange) =>
	badRequestOnError(() => cancelExplainerJob(repo, start, stop))
);
