import { inSpan } from '$lib/ask/span';
import { spanAt } from '$lib/diff/hunks';
import type { Layout } from '$lib/diff/split';
import type { DiffFile, Hunk } from '$lib/diff/types';
import type { ReviewThread } from './types';

/** One line's piece of the review threads' bar. */
export interface ReviewMark {
	first: boolean;
	last: boolean;
	/** has comments of yours not posted yet */
	pending: boolean;
	/** the threads whose last line this is */
	threads: ReviewThread[];
}

/**
 * A file's review threads on its lines in `hunks` (the ones on screen), by `hunk:index`,
 * with `:side` added in the split layout where each side has its own gutter. `unplaced`
 * are the ones with no lines here: outdated, about the whole file, or on lines the diff
 * doesn't show.
 */
export function placeThreads(
	file: DiffFile,
	hunks: Hunk[],
	threads: ReviewThread[],
	layout: Layout
): { marks: Map<string, ReviewMark>; unplaced: ReviewThread[] } {
	const marks = new Map<string, ReviewMark>();
	const unplaced: ReviewThread[] = [];
	for (const thread of threads) {
		if (thread.path !== file.newPath && thread.path !== file.oldPath) continue;
		const span =
			thread.isOutdated || thread.line === null
				? null
				: spanAt([file], thread.path, thread.side, thread.line, thread.startLine ?? thread.line);
		if (!span) {
			unplaced.push(thread);
			continue;
		}
		const hunk = hunks.find((h) => h.id === span.hunk);
		if (!hunk) continue;
		const pending = thread.comments.some((c) => c.pending);
		const indexes: number[] = [];
		for (let i = span.start; i <= span.end; i++) {
			if (inSpan(span, i, hunk.lines[i])) indexes.push(i);
		}
		indexes.forEach((i, n) => {
			const key = layout === 'split' ? `${span.hunk}:${i}:${span.side}` : `${span.hunk}:${i}`;
			const before = marks.get(key);
			const last = n === indexes.length - 1;
			marks.set(key, {
				first: n === 0 || (before?.first ?? false),
				last: last || (before?.last ?? false),
				pending: pending || (before?.pending ?? false),
				threads: [...(before?.threads ?? []), ...(last ? [thread] : [])]
			});
		});
	}
	return { marks, unplaced };
}
