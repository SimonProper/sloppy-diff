import { readJson, writeJson } from '$lib/storage';
import { ordered, type Tabs } from './places';

/** The title strip's tabs for a repo, as kept in this browser. Null before the first look. */
let version = $state(0);
const key = (main: string) => `worktree-tabs:${main}`;

export function readTabs(main: string): Tabs | null {
	void version;
	const tabs = readJson<Tabs | null>(key(main), null);
	// kept by an earlier version of the strip, started again
	return tabs && Array.isArray(tabs.closed) ? tabs : null;
}

export function saveTabs(main: string, tabs: Tabs) {
	writeJson(key(main), tabs);
	version++;
}

/** A pull request's tab become its worktree's once it's checked out, the last of the worktrees. */
export function checkedOut(main: string, number: number, path: string) {
	const tabs = readTabs(main);
	if (!tabs) return;
	saveTabs(main, {
		order: [...tabs.order.filter((p) => p !== path), path],
		closed: tabs.closed.filter((p) => p !== path),
		prs: tabs.prs.filter((n) => n !== number),
		preview: tabs.preview === number ? null : tabs.preview
	});
}

/** Worktrees in their tabs' order, for the sidebar beside them. */
export function inTabOrder<T extends { path: string; main: boolean }>(
	main: string,
	trees: T[]
): T[] {
	return ordered(trees, readTabs(main)?.order ?? []);
}
