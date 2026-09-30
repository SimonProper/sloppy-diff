import type { DiffFile } from '$lib/diff/types';
import { orderSections } from '$lib/guide/order';
import type { Guide } from '$lib/guide/types';
import { linesOf, type Thread } from './types';

export interface Group {
	key: string;
	label: string;
	threads: Thread[];
}

/**
 * Questions in the order they're read: the whole change first, then by guide section
 * when a guide is open, else by file in diff order, and the questions about changed code
 * last. A question about a whole file comes first in its file, or in the first section
 * that reads it.
 */
export function groupThreads(list: Thread[], files: DiffFile[], guide?: Guide | null): Group[] {
	const current = list.filter((t) => !t.outdated);
	const result: Group[] = [];
	const change = current.filter((t) => !t.anchor.path);
	if (change.length) result.push({ key: 'change', label: 'Whole change', threads: change });

	const fileOf = new Map(files.flatMap((f) => f.hunks.map((h) => [h.id, f.newPath] as const)));
	/** Sorts by where the lines are in `order`, a whole file before its lines. */
	const by = (order: string[]) => (a: Thread, b: Thread) => {
		const [x, y] = [linesOf(a.anchor), linesOf(b.anchor)];
		if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
		return order.indexOf(x.hunk) - order.indexOf(y.hunk) || x.start - y.start;
	};

	if (guide) {
		const sections = orderSections(guide.sections);
		// a whole file is asked about in the first section that reads it
		const firstSection = new Map<string, string>();
		for (const section of sections) {
			for (const hunk of section.hunks) {
				const path = fileOf.get(hunk);
				if (path && !firstSection.has(path)) firstSection.set(path, section.id);
			}
		}
		sections.forEach((section, i) => {
			const hunks = new Set(section.hunks);
			const here = current
				.filter((t) => {
					const lines = linesOf(t.anchor);
					return lines ? hunks.has(lines.hunk) : firstSection.get(t.anchor.path) === section.id;
				})
				.sort(by(section.hunks));
			if (here.length) {
				result.push({ key: section.id, label: `§${i + 1} ${section.title}`, threads: here });
			}
		});
	} else {
		for (const file of files) {
			const here = current
				.filter((t) => t.anchor.path === file.newPath)
				.sort(by(file.hunks.map((h) => h.id)));
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
