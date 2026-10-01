import { query } from '$app/server';
import { listPullRequests } from '$lib/server/gh';
import { repoRoot } from '$lib/server/git';

/** The repo's open pull requests, null without gh or GitHub. */
export const getPullRequests = query('unchecked', async (repo: string) =>
	listPullRequests(await repoRoot(repo)).catch(() => null)
);
