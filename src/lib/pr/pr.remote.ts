import { command, query } from '$app/server';
import type { Suggestion } from '$lib/ask/types';
import {
	addPrComment,
	addReviewComment,
	changePullRequest,
	deleteComment,
	editComment,
	recentPullRequests,
	mergePullRequest,
	updateBranch,
	type MergeOptions,
	type PrChange,
	resolveThread,
	submitReview,
	type VerdictEvent
} from '$lib/server/gh';
import { repoRoot } from '$lib/server/git';
import { forgetPrs } from '$lib/server/cache';
import { badRequestOnError } from '$lib/server/requests';

/** The repo's open pull requests, null without gh or GitHub. */
export const getPullRequests = query('unchecked', async (repo: string) =>
	recentPullRequests(await repoRoot(repo)).catch(() => null)
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

/** Resolves a review thread, or opens it again. */
export const setResolved = command(
	'unchecked',
	({ repo, thread, resolved }: { repo: string; thread: string; resolved: boolean }) =>
		badRequestOnError(async () => {
			await resolveThread(await repoRoot(repo), thread, resolved === true);
			forgetPrs();
		})
);

/** Submits your review on the pull request `pr` (its node id), the pending one if there is one. */
export const finishReview = command(
	'unchecked',
	({ repo, pr, event, body }: { repo: string; pr: string; event: VerdictEvent; body: string }) =>
		badRequestOnError(async () => {
			await submitReview(await repoRoot(repo), pr, event, body);
			forgetPrs();
		})
);

/** Closes, reopens, readies or drafts the pull request `pr` (its node id). */
export const changePr = command(
	'unchecked',
	({ repo, pr, change }: { repo: string; pr: string; change: PrChange }) =>
		badRequestOnError(async () => {
			await changePullRequest(await repoRoot(repo), pr, change);
			forgetPrs();
		})
);

/** Merges the base into the pull request's branch. */
export const updatePrBranch = command(
	'unchecked',
	({ repo, pr, head }: { repo: string; pr: string; head: string }) =>
		badRequestOnError(async () => {
			await updateBranch(await repoRoot(repo), pr, head);
			forgetPrs();
		})
);

/** Merges the pull request, and deletes its branch when asked. */
export const mergePr = command(
	'unchecked',
	({ repo, pr, options }: { repo: string; pr: string; options: MergeOptions }) =>
		badRequestOnError(async () => {
			await mergePullRequest(await repoRoot(repo), pr, options);
			forgetPrs();
		})
);
