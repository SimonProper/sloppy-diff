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
	url: string;
	author: string;
	state: 'OPEN' | 'CLOSED' | 'MERGED';
	isDraft: boolean;
	baseRefName: string;
	headRefName: string;
	baseRefOid: string;
	/** comments are pinned to this commit, the one the diff shows */
	headRefOid: string;
	/** the conversation, comments not on any lines */
	comments: PrComment[];
	threads: ReviewThread[];
	/** your pending review, where drafted comments go, null until there is one */
	pendingReviewId: string | null;
}

export interface PrComment {
	id: string;
	author: string;
	/** markdown */
	body: string;
	createdAt: string;
	url: string;
	/** part of your pending review, not posted yet */
	pending: boolean;
}

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
