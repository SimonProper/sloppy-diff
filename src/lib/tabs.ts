/** The header's switch: agents writing changes, then the ways of comparing them. */
export type Tab = 'agents' | 'worktree' | 'branch' | 'range' | 'pr';

export const TABS: { value: Tab; label: string }[] = [
	{ value: 'agents', label: 'Agents' },
	{ value: 'worktree', label: 'Uncommitted' },
	{ value: 'branch', label: 'Branch' },
	{ value: 'range', label: 'Range' },
	{ value: 'pr', label: 'Pull request' }
];
