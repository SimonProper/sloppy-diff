import type { Side } from '$lib/ask/types';

/**
 * A GitHub pull request as read through `gh api graphql`, with its review threads.
 * The diff itself isn't here: it's the range from the merge base of `baseRefOid` and
 * `headRefOid` to `headRefOid`, shown like any other range.
 */
export interface PullRequest {
	/** GraphQL node id, the mutations take it */
	id: string;
	number: number;
	title: string;
	/** the description, markdown */
	body: string;
	/** `body` as GitHub renders it, sanitized */
	bodyHtml: string;
	url: string;
	author: string;
	state: 'OPEN' | 'CLOSED' | 'MERGED';
	isDraft: boolean;
	baseRefName: string;
	headRefName: string;
	baseRefOid: string;
	/** comments are pinned to this commit, the one the diff shows */
	headRefOid: string;
	/** the conversation, latest activity last: comments not on any lines, and reviews that say
	 * something or started threads */
	comments: PrComment[];
	threads: ReviewThread[];
	/** your pending review, where drafted comments go, null until there is one */
	pendingReviewId: string | null;
}

export interface PrComment {
	id: string;
	author: string;
	/** the author's picture on GitHub, none for a deleted account */
	avatar: string;
	/** markdown */
	body: string;
	createdAt: string;
	url: string;
	/** part of your pending review, not posted yet */
	pending: boolean;
	/** `body` as GitHub renders it, sanitized */
	html: string;
	/** a review's verdict, where the conversation has one */
	review?: ReviewState;
	/** the threads a review started, by id, their replies in them whichever review they came in */
	threads?: string[];
}

export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';

/** Comments on lines or a whole file of the diff, and the replies to them. */
export interface ReviewThread {
	/** GraphQL node id, replies take it */
	id: string;
	path: string;
	/** about the whole file, without lines */
	file: boolean;
	/** last and first line, numbered on `side`; null when GitHub can't place them on the current diff */
	line: number | null;
	startLine: number | null;
	side: Side;
	isResolved: boolean;
	isOutdated: boolean;
	/** the code the thread was started on, for one whose lines changed since */
	diffHunk: string;
	comments: PrComment[];
}

/** The pull requests listed: all open ones, those waiting on your review, or yours. */
export const PR_VIEWS = ['all', 'review', 'mine'] as const;
export type PrView = (typeof PR_VIEWS)[number];

/** A pull request as `gh pr list` lists it, to pick one. */
export interface PrSummary {
	number: number;
	title: string;
	author: string;
	headRefName: string;
	baseRefName: string;
	isDraft: boolean;
	updatedAt: string;
	/** null when the repo doesn't require reviews */
	reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
	/** you opened it */
	mine: boolean;
	/** your review is requested */
	requested: boolean;
	/** your latest review */
	reviewed: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | null;
}
