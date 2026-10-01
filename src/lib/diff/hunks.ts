import type { LineSpan, Side } from '$lib/ask/types';
import type { DiffFile, DiffLine, Hunk } from './types';

/** the file and hunk with this id, null once it's gone from the diff */
export function findHunk(files: DiffFile[], id: string): { file: DiffFile; hunk: Hunk } | null {
	for (const file of files) {
		const hunk = file.hunks.find((h) => h.id === id);
		if (hunk) return { file, hunk };
	}
	return null;
}

/** added, deleted and all lines across some hunks */
export function lineStats(hunks: Hunk[]) {
	let additions = 0;
	let deletions = 0;
	let lines = 0;
	for (const h of hunks) {
		lines += h.lines.length;
		for (const l of h.lines) {
			if (l.kind === 'add') additions++;
			else if (l.kind === 'del') deletions++;
		}
	}
	return { additions, deletions, lines };
}

/** changed with no tokens marked as new: in lines mode, or new or removed as a whole */
export function tinted(line: DiffLine) {
	return line.kind !== 'ctx' && !line.spans?.length && !line.reformatted;
}

/**
 * The span covering lines `startLine` to `line` of a file, numbered on `side`, the way
 * GitHub and Claude's suggestions name lines. Null when they aren't in one hunk of the diff.
 */
export function spanAt(
	files: DiffFile[],
	path: string,
	side: Side,
	line: number,
	startLine = line
): LineSpan | null {
	const file = files.find((f) => f.newPath === path || f.oldPath === path);
	const number = (l: DiffLine) => (side === 'old' ? l.old : l.new);
	for (const hunk of file?.hunks ?? []) {
		const start = hunk.lines.findIndex((l) => number(l) === startLine);
		const end = hunk.lines.findIndex((l) => number(l) === line);
		if (start !== -1 && end !== -1 && start <= end) return { hunk: hunk.id, start, end, side };
	}
	return null;
}
