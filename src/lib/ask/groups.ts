import type { DiffFile } from '$lib/diff/types';
import { orderSections } from '$lib/guide/order';
import type { Guide } from '$lib/guide/types';
import type { Thread } from './types';

export interface Group {
	key: string;
	label: string;
	threads: Thread[];
}

/**
 * Questions in the order they're read: by guide section when a guide is open,
 * else by file in diff order, and the questions about changed code last.
 */
export function groupThreads(list: Thread[], files: DiffFile[], guide?: Guide | null): Group[] {
	const current = list.filter((t) => !t.outdated);
	const result: Group[] = [];
	const position = new Map(files.flatMap((f) => f.hunks.map((h, i) => [h.id, i] as const)));
	const byLines = (a: Thread, b: Thread) =>
		(position.get(a.anchor.hunk) ?? 0) - (position.get(b.anchor.hunk) ?? 0) ||
		a.anchor.start - b.anchor.start;

	if (guide) {
		orderSections(guide.sections).forEach((section, i) => {
			const hunks = new Set(section.hunks);
			const here = current
				.filter((t) => hunks.has(t.anchor.hunk))
				.sort(
					(a, b) =>
						section.hunks.indexOf(a.anchor.hunk) - section.hunks.indexOf(b.anchor.hunk) ||
						a.anchor.start - b.anchor.start
				);
			if (here.length) {
				result.push({ key: section.id, label: `§${i + 1} ${section.title}`, threads: here });
			}
		});
	} else {
		for (const file of files) {
			const hunks = new Set(file.hunks.map((h) => h.id));
			const here = current.filter((t) => hunks.has(t.anchor.hunk)).sort(byLines);
			if (here.length) result.push({ key: file.id, label: file.newPath, threads: here });
		}
	}
	const outdated = list.filter((t) => t.outdated);
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
