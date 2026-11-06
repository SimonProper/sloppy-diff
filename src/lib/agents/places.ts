import type { PrSummary } from '$lib/pr/types';
import type { SessionSummary, Worktree } from './types';

/** Where a page is: the pull request list, a worktree, or a pull request read on its own. */
export type Place =
	| { kind: 'prs' }
	| { kind: 'tree'; path: string }
	/** read in `root`, a worktree only when it's the one the PR is checked out in */
	| { kind: 'pr'; number: number; root: string };

type Prs = PrSummary[] | null | undefined;

/**
 * The open pull request a worktree has checked out: by its branch, or by its name for one made by
 * Check out, `pr-<number>`, whatever gh named the branch (a fork's `main` for one).
 * ponytail: by name only, a fork's branch named like one here would match it too
 */
export function linkedPr(tree: Pick<Worktree, 'branch' | 'path'>, prs: Prs): PrSummary | null {
	const made = /\/pr-(\d+)$/.exec(tree.path)?.[1];
	return (
		prs?.find(
			(p) =>
				String(p.number) === made ||
				(!!tree.branch && p.headRefName === tree.branch && p.headRefName !== p.baseRefName)
		) ?? null
	);
}

/** The worktree pull request `number` is checked out in, if any. */
export function worktreeOfPr<T extends Pick<Worktree, 'branch' | 'path'>>(
	number: number,
	trees: T[] | undefined,
	prs: Prs
): T | null {
	return trees?.find((t) => linkedPr(t, prs)?.number === number) ?? null;
}

const working = (s: SessionSummary) => s.status === 'running' || s.status === 'starting';

/** Who has to act next on a session, loudest first: you (an approval), it (working), you again. */
const SIGNALS = [
	{ is: (s) => s.waiting, glyph: 'dot', class: 'bg-mod', title: 'Needs you' },
	{ is: working, glyph: 'dot', class: 'bg-accent animate-pulse', title: 'Working' },
	{
		is: (s) => s.unread && !!s.failed,
		glyph: 'dot',
		class: 'bg-del',
		title: 'Stopped or failed, not looked at yet'
	},
	{ is: (s) => s.unread, glyph: 'check', class: 'text-accent', title: 'Done, not looked at yet' },
	{ is: () => true, glyph: 'dot', class: 'bg-muted/50', title: 'Idle' }
] satisfies { is: (s: SessionSummary) => boolean; glyph: string; class: string; title: string }[];

export function signal(s: SessionSummary) {
	return SIGNALS.find((x) => x.is(s))!;
}

/** The open session in a worktree that says most about it, none when they're all idle. */
export function loudest(sessions: SessionSummary[]): SessionSummary | null {
	const rank = (s: SessionSummary) => SIGNALS.findIndex((x) => x.is(s));
	const best = sessions.filter((s) => s.open).sort((a, b) => rank(a) - rank(b))[0];
	return best && rank(best) < SIGNALS.length - 1 ? best : null;
}

/** The title strip's tabs as kept for a repo. */
export interface Tabs {
	/** worktrees in the order they were dragged into, closed ones too: the sidebar keeps it */
	order: string[];
	/** worktrees whose tab was closed, open again once you go to one */
	closed: string[];
	/** pull requests kept as tabs, read without a worktree */
	prs: number[];
	/** the one opened last and not kept, replaced by the next as an editor's preview is */
	preview: number | null;
}

type Tree = Pick<Worktree, 'path' | 'branch' | 'main' | 'sessions'>;

/** Worktrees in the order they were dragged into, the main checkout first, new ones after. */
export function ordered<T extends Pick<Worktree, 'path' | 'main'>>(
	trees: T[],
	order: string[]
): T[] {
	const at = (t: T) =>
		t.main ? -1 : order.includes(t.path) ? order.indexOf(t.path) : order.length;
	return [...trees].sort((a, b) => at(a) - at(b));
}

/**
 * The tabs, by key: the main checkout's, the other open worktrees' by path, then pull requests'
 * read without a worktree as `#<number>`. One checked out since has its worktree's tab instead.
 */
export function tabKeys(tabs: Tabs, trees: Tree[], prs: Prs): string[] {
	const open = ordered(trees, tabs.order).filter((t) => t.main || !tabs.closed.includes(t.path));
	const read = [
		...tabs.prs,
		...(tabs.preview && !tabs.prs.includes(tabs.preview) ? [tabs.preview] : [])
	];
	return [
		...open.map((t) => t.path),
		...read.filter((n) => !worktreeOfPr(n, trees, prs)).map((n) => `#${n}`)
	];
}

/** A first look's tabs: the main checkout, and the worktrees an agent works in or a PR is in. */
export function firstTabs(trees: Tree[], prs: Prs): Tabs {
	const quiet = (t: Tree) => !t.main && !t.sessions.some((s) => s.open) && !linkedPr(t, prs);
	return { order: [], closed: trees.filter(quiet).map((t) => t.path), prs: [], preview: null };
}

/**
 * The tabs with `key` dragged onto `over`'s place, worktrees and pull requests (`#<number>`) each
 * among their own: unchanged when they're one of each.
 */
export function moveTab(keys: string[], key: string, over: string): string[] {
	const from = keys.indexOf(key);
	const to = keys.indexOf(over);
	if (from < 0 || to < 0 || from === to || key.startsWith('#') !== over.startsWith('#'))
		return keys;
	const next = keys.filter((k) => k !== key);
	next.splice(to, 0, key);
	return next;
}

/** The tabs kept after dragging them into `keys`' order: a preview dragged is kept as a tab. */
export function reordered(tabs: Tabs, keys: string[]): Tabs {
	const trees = keys.filter((k) => !k.startsWith('#'));
	const prs = keys.filter((k) => k.startsWith('#')).map((k) => Number(k.slice(1)));
	return {
		...tabs,
		order: [...trees, ...tabs.order.filter((p) => !trees.includes(p))],
		prs,
		preview: tabs.preview !== null && prs.includes(tabs.preview) ? null : tabs.preview
	};
}
