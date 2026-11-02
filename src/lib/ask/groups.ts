import { orderSections } from '$lib/guide/order';
import type { Guide } from '$lib/guide/types';
import type { Thread } from './types';

export interface Group {
	key: string;
	label: string;
	threads: Thread[];
}

/**
 * The chats with the one asked or answered in last at the top, those about code that
 * changed since under them. The current ones are one group without a label.
 */
export function groupThreads(list: Thread[]): Group[] {
	const last = (t: Thread) => t.messages.at(-1)?.createdAt ?? t.createdAt;
	const recent = (outdated: boolean) =>
		list.filter((t) => !!t.outdated === outdated).sort((a, b) => last(b).localeCompare(last(a)));
	const result: Group[] = [];
	const current = recent(false);
	if (current.length) result.push({ key: 'current', label: '', threads: current });
	const outdated = recent(true);
	if (outdated.length) {
		result.push({ key: 'outdated', label: 'Code changed since', threads: outdated });
	}
	return result;
}

/** The guide section a hunk is read in, "§2", numbered in reading order. */
export function sectionLabel(guide: Guide | null | undefined, hunk: string): string | undefined {
	if (!guide) return undefined;
	const i = orderSections(guide.sections).findIndex((s) => s.hunks.includes(hunk));
	return i < 0 ? undefined : `§${i + 1}`;
}

/** "L12–15", "L3 (old)" */
export const shortLines = (label: string) => label.replace(/^lines? /, 'L');
