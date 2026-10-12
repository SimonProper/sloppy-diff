import type { DiffLine, Hunk } from './types';

export interface WholeFile {
	/** the new side's lines */
	text: string[];
	/** and their markup */
	html: string[];
}

export interface Gaps {
	/** the unchanged lines before each hunk, as context */
	before: DiffLine[][];
	/** and after the last one */
	after: DiffLine[];
}

/** Where a hunk's lines start on one side: git numbers an empty side by the line before it. */
const first = (start: number, count: number) => (count ? start : start + 1);

/**
 * The lines the diff leaves out between `hunks`, from the whole new file. Null
 * when the file isn't the one the hunks were read from anymore, the working tree
 * changed since.
 */
export function gapsOf(hunks: Hunk[], file: WholeFile): Gaps | null {
	const fits = hunks.every((h) =>
		h.lines.every((l) => l.new === null || file.text[l.new - 1] === l.text)
	);
	if (!fits) return null;

	const run = (from: number, to: number, shift: number): DiffLine[] =>
		file.text.slice(from - 1, to - 1).map((text, i) => ({
			kind: 'ctx',
			text,
			old: from + i + shift,
			new: from + i,
			html: file.html[from - 1 + i]
		}));

	// the next line after the hunks so far, on each side
	let [old, now] = [1, 1];
	const before = hunks.map((h) => {
		const [oldFirst, newFirst] = [first(h.oldStart, h.oldLines), first(h.newStart, h.newLines)];
		const gap = run(now, newFirst, old - now);
		[old, now] = [oldFirst + h.oldLines, newFirst + h.newLines];
		return gap;
	});
	return { before, after: run(now, file.text.length + 1, old - now) };
}
