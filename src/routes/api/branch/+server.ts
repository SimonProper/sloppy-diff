import { error, json } from '@sveltejs/kit';
import { defaultBranch, describeBranch, errorMessage, repoRoot } from '$lib/server/git';
import type { RequestHandler } from './$types';

/** A branch from where it split off to its tip, for picking what a guide covers. */
export const GET: RequestHandler = async ({ url }) => {
	const [repo, branch] = ['repo', 'branch'].map((k) => url.searchParams.get(k) ?? '');
	try {
		const root = await repoRoot(repo);
		return json(await describeBranch(root, branch, await defaultBranch(root)));
	} catch (e) {
		error(400, errorMessage(e));
	}
};
