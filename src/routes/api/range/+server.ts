import { error, json } from '@sveltejs/kit';
import { getJob } from '$lib/server/generate';
import {
	commitsInRange,
	errorMessage,
	repoRoot,
	resolveCommit,
	resolveStart
} from '$lib/server/git';
import { loadGuide } from '$lib/server/guides';
import type { RequestHandler } from './$types';

/** What a guide for start..stop would cover, and whether one exists or is running. */
export const GET: RequestHandler = async ({ url }) => {
	const [repo, start, stop] = ['repo', 'start', 'stop'].map((k) => url.searchParams.get(k) ?? '');
	try {
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
		return json({
			start: startSha,
			stop: stopSha,
			commits,
			hasGuide: guide !== null,
			running: job !== undefined && !job.finished
		});
	} catch (e) {
		error(400, errorMessage(e));
	}
};
