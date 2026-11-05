import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { mainCheckout } from '$lib/server/agents';
import { errorMessage, repoRoot } from '$lib/server/git';
import type { PageServerLoad } from './$types';

/** The repo's main checkout, and the worktree the url names, where a new session starts. */
export const load: PageServerLoad = async ({ url }) => {
	const param = url.searchParams.get('repo') || env.REPO || process.cwd();
	try {
		const here = await repoRoot(param);
		return { repo: await mainCheckout(here), here };
	} catch (e) {
		error(400, errorMessage(e));
	}
};
