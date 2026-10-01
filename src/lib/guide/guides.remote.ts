import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { cancelJob, getJob, startGuide } from '$lib/server/generate';
import {
	commitsInRange,
	defaultBranch,
	describeBranch,
	repoRoot,
	resolveCommit,
	resolveStart
} from '$lib/server/git';
import { deleteGuide, loadGuide } from '$lib/server/guides';
import { watchJob } from '$lib/server/jobs';
import { badRequestOnError } from '$lib/server/requests';
import { applyGuideEvent, startProgress } from './progress';

type Range = { repo: string; start: string; stop: string };

/** A branch from where it split off to its tip, for picking what a guide covers. */
export const getBranch = query('unchecked', ({ repo, branch }: { repo: string; branch: string }) =>
	badRequestOnError(async () => {
		const root = await repoRoot(repo);
		return describeBranch(root, branch, await defaultBranch(root));
	})
);

/** What a guide for start..stop would cover, and whether one exists or is running. */
export const getRange = query('unchecked', ({ repo, start, stop }: Range) =>
	badRequestOnError(async () => {
		const root = await repoRoot(repo);
		const [startSha, stopSha] = await Promise.all([
			resolveStart(root, start),
			resolveCommit(root, stop)
		]);
		const [commits, guide] = await Promise.all([
			commitsInRange(root, startSha, stopSha),
			loadGuide(root, startSha, stopSha)
		]);
		const job = getJob(root, startSha, stopSha);
		return {
			start: startSha,
			stop: stopSha,
			commits,
			hasGuide: guide !== null,
			running: job !== undefined && !job.finished
		};
	})
);

/** Starts generating a guide for start..stop, or joins the one already running. */
export const generateGuide = command(
	'unchecked',
	({ repo, start, stop, pr }: Range & { pr?: number }) =>
		badRequestOnError(async () => {
			const root = await repoRoot(repo);
			const range = {
				start: await resolveStart(root, start),
				stop: await resolveCommit(root, stop)
			};
			startGuide(root, range.start, range.stop, pr);
			return { repo: root, ...range };
		})
);

/**
 * How the generation for start..stop (resolved shas) is going, until it's done.
 * `follow` only keys the stream, like followAnswer's.
 */
export const followGuide = query.live(
	'unchecked',
	async function* ({ repo, start, stop }: Range & { follow: string }) {
		const job = getJob(repo, start, stop);
		if (!job) error(404, 'No guide is being generated for this range');
		yield* watchJob(job, applyGuideEvent, startProgress(), getRequestEvent().request.signal);
	}
);

export const cancelGuide = command('unchecked', ({ repo, start, stop }: Range) => {
	cancelJob(repo, start, stop);
});

/** Deletes a saved guide. The repo is the one it was saved for, it may be gone by now. */
export const deleteSavedGuide = command('unchecked', ({ repo, start, stop }: Range) =>
	badRequestOnError(() => deleteGuide(repo, start, stop))
);
