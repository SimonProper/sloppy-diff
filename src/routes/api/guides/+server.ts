import { error, json } from '@sveltejs/kit';
import { cancelJob, startGuide } from '$lib/server/generate';
import { errorMessage, repoRoot, resolveCommit, resolveStart } from '$lib/server/git';
import type { RequestHandler } from './$types';

/** Starts generating a guide for start..stop, or joins the one already running. */
export const POST: RequestHandler = async ({ request }) => {
	const { repo, start, stop } = await request.json();
	try {
		const root = await repoRoot(repo);
		const range = {
			start: await resolveStart(root, start),
			stop: await resolveCommit(root, stop)
		};
		startGuide(root, range.start, range.stop);
		return json({ repo: root, ...range });
	} catch (e) {
		error(400, errorMessage(e));
	}
};

export const DELETE: RequestHandler = async ({ url }) => {
	const [repo, start, stop] = ['repo', 'start', 'stop'].map((k) => url.searchParams.get(k) ?? '');
	cancelJob(repo, start, stop);
	return new Response(null, { status: 204 });
};
