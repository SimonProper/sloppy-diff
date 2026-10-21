import { command, query } from '$app/server';
import type { Suggestion } from '$lib/ask/types';
import {
	addPrComment,
	addReviewComment,
	deleteComment,
	editComment,
	listPullRequests
} from '$lib/server/gh';
import { repoRoot } from '$lib/server/git';
import { forgetPrs } from '$lib/server/cache';
import { badRequestOnError } from '$lib/server/requests';

/** The repo's open pull requests, null without gh or GitHub. */
export const getPullRequests = query('unchecked', async (repo: string) =>
	listPullRequests(await repoRoot(repo)).catch(() => null)
);

/** Comments on lines or replies on the pull request `pr` (its node id): with `post` at once,
 * otherwise in your pending review. */
export const commentOnReview = command(
	'unchecked',
	({
		repo,
		pr,
		commit,
		suggestion,
		post
	}: {
		repo: string;
		pr: string;
		commit: string;
		suggestion: Suggestion;
		post?: boolean;
	}) =>
		badRequestOnError(async () => {
			const added = await addReviewComment(
				await repoRoot(repo),
				pr,
				commit,
				suggestion,
				post === true
			);
			forgetPrs();
			return added;
		})
);

/** Deletes a comment GitHub says you may delete. */
export const removeComment = command(
	'unchecked',
	({ repo, id, kind }: { repo: string; id: string; kind: 'issue' | 'thread' }) =>
		badRequestOnError(async () => {
			await deleteComment(await repoRoot(repo), id, kind);
			forgetPrs();
		})
);

/** Edits a comment GitHub says you may edit. */
export const updateComment = command(
	'unchecked',
	({
		repo,
		id,
		kind,
		body
	}: {
		repo: string;
		id: string;
		kind: 'issue' | 'thread';
		body: string;
	}) =>
		badRequestOnError(async () => {
			await editComment(await repoRoot(repo), id, kind, body);
			forgetPrs();
		})
);

/** Comments on the pull request `pr` (its node id), posted at once. */
export const addComment = command(
	'unchecked',
	({ repo, pr, body }: { repo: string; pr: string; body: string }) =>
		badRequestOnError(async () => {
			await addPrComment(await repoRoot(repo), pr, body);
			forgetPrs();
		})
);
