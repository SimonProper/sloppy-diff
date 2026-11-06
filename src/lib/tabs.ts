/** The mode bar's switch: agents writing changes in the worktree, then the ways of comparing them. */
export type Tab = 'agents' | 'worktree' | 'branch' | 'range' | 'pr';

/** A worktree's modes, the last its pull request's when it has one. */
export function modes(pr: number | null): { value: Tab; label: string }[] {
	return [
		{ value: 'agents', label: 'Agents' },
		{ value: 'worktree', label: 'Uncommitted' },
		{ value: 'branch', label: 'Branch' },
		{ value: 'range', label: 'Range' },
		...(pr ? [{ value: 'pr' as const, label: `PR #${pr}` }] : [])
	];
}

/**
 * What sticks at the top of the page, in pixels: the strip of worktree tabs (48, the title bar's
 * height in the app, its window buttons centred in it) and the mode bar under it (44).
 */
export const HEADER = 92;
