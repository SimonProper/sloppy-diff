import type { DiffLine, Hunk } from './types';

export type Layout = 'unified' | 'split';

export interface SplitRow {
	/** old side: a context or removed line, null when this row only adds */
	left: DiffLine | null;
	/** new side: a context or added line, null when this row only removes */
	right: DiffLine | null;
}

/**
 * Pairs a hunk's lines for side by side display. Context lines sit on both
 * sides, and within each run of changes the nth removed line faces the nth
 * added line, with the longer side running on alone.
 */
export function splitRows(hunk: Hunk): SplitRow[] {
	const rows: SplitRow[] = [];
	let dels: DiffLine[] = [];
	let adds: DiffLine[] = [];

	const flush = () => {
		for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
			rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
		}
		dels = [];
		adds = [];
	};

	for (const line of hunk.lines) {
		if (line.kind === 'ctx') {
			flush();
			rows.push({ left: line, right: line });
		} else if (line.kind === 'del') {
			// git lists removals before additions, a removal after one starts a new run
			if (adds.length) flush();
			dels.push(line);
		} else {
			adds.push(line);
		}
	}
	flush();
	return rows;
}
