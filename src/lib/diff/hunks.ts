import type { DiffLine, Hunk } from './types';

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
