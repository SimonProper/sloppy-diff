import { command, query } from '$app/server';
import type { Suggestion } from '$lib/ask/types';
import { addToDraft, listPullRequests } from '$lib/server/gh';
import { repoRoot } from '$lib/server/git';
import { badRequestOnError } from '$lib/server/requests';

/** The repo's open pull requests, null without gh or GitHub. */
export const getPullRequests = query('unchecked', async (repo: string) =>
	listPullRequests(await repoRoot(repo)).catch(() => null)
);

/** Adds a suggested comment to your pending review on the pull request `pr` (its node id). */
export const addDraft = command(
	'unchecked',
	({
		repo,
		pr,
		commit,
		suggestion
	}: {
		repo: string;
		pr: string;
		commit: string;
		suggestion: Suggestion;
	}) => badRequestOnError(async () => addToDraft(await repoRoot(repo), pr, commit, suggestion))
);
