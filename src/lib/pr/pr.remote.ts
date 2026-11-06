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
import { mainCheckout } from '$lib/server/agents';
import { forgetPr } from '$lib/server/cache';
import { badRequestOnError } from '$lib/server/requests';

/** The repo's open pull requests, null without gh or GitHub. One list for all its worktrees. */
export const getPullRequests = query('unchecked', async (repo: string) =>
	recentPullRequests(await mainCheckout(await repoRoot(repo))).now.catch(() => null)
);

/**
 * A write to GitHub about the pull request `number`, the one on screen: kept as it was
 * read last, it's read again before it's shown.
 */
function write<T>(repo: string, number: number, run: (root: string) => Promise<T>) {
	return badRequestOnError(async () => {
		const root = await repoRoot(repo);
		const result = await run(root);
		forgetPr(root, number, await mainCheckout(root));
		return result;
	});
}

/** Comments on lines or replies on the pull request `pr` (its node id): with `post` at once,
 * otherwise in your pending review. */
export const commentOnReview = command(
	'unchecked',
	({
		repo,
		number,
		pr,
		commit,
		suggestion,
		post
	}: {
		repo: string;
		number: number;
		pr: string;
		commit: string;
		suggestion: Suggestion;
		post?: boolean;
	}) => write(repo, number, (root) => addReviewComment(root, pr, commit, suggestion, post === true))
);

/** Deletes a comment GitHub says you may delete. */
export const removeComment = command(
	'unchecked',
	({
		repo,
		number,
		id,
		kind
	}: {
		repo: string;
		number: number;
		id: string;
		kind: 'issue' | 'thread';
	}) => write(repo, number, (root) => deleteComment(root, id, kind))
);

/** Edits a comment GitHub says you may edit. */
export const updateComment = command(
	'unchecked',
	({
		repo,
		number,
		id,
		kind,
		body
	}: {
		repo: string;
		number: number;
		id: string;
		kind: 'issue' | 'thread';
		body: string;
	}) => write(repo, number, (root) => editComment(root, id, kind, body))
);

/** Comments on the pull request `pr` (its node id), posted at once. */
export const addComment = command(
	'unchecked',
	({ repo, number, pr, body }: { repo: string; number: number; pr: string; body: string }) =>
		write(repo, number, (root) => addPrComment(root, pr, body))
);

/** Resolves a review thread, or opens it again. */
export const setResolved = command(
	'unchecked',
	({
		repo,
		number,
		thread,
		resolved
	}: {
		repo: string;
		number: number;
		thread: string;
		resolved: boolean;
	}) => write(repo, number, (root) => resolveThread(root, thread, resolved === true))
);

/** Submits your review on the pull request `pr` (its node id), the pending one if there is one. */
export const finishReview = command(
	'unchecked',
	({
		repo,
		number,
		pr,
		event,
		body
	}: {
		repo: string;
		number: number;
		pr: string;
		event: VerdictEvent;
		body: string;
	}) => write(repo, number, (root) => submitReview(root, pr, event, body))
);

/** Closes, reopens, readies or drafts the pull request `pr` (its node id). */
export const changePr = command(
	'unchecked',
	({ repo, number, pr, change }: { repo: string; number: number; pr: string; change: PrChange }) =>
		write(repo, number, (root) => changePullRequest(root, pr, change))
);

/** Merges the base into the pull request's branch. */
export const updatePrBranch = command(
	'unchecked',
	({ repo, number, pr, head }: { repo: string; number: number; pr: string; head: string }) =>
		write(repo, number, (root) => updateBranch(root, pr, head))
);

/** Merges the pull request, and deletes its branch when asked. */
export const mergePr = command(
	'unchecked',
	({
		repo,
		number,
		pr,
		options
	}: {
		repo: string;
		number: number;
		pr: string;
		options: MergeOptions;
	}) => write(repo, number, (root) => mergePullRequest(root, pr, options))
);
