import { spanNumbers } from '$lib/ask/span';
import type { LineSpan, Suggestion } from '$lib/ask/types';
import { findHunk } from '$lib/diff/hunks';
import type { DiffFile } from '$lib/diff/types';

/**
 * Your own comment on picked lines or a whole file, the way GitHub takes it. Null for the
 * whole change, that's the review's summary, written when finishing it on GitHub.
 */
export function commentOn(
	files: DiffFile[],
	about: { span?: LineSpan; path?: string },
	body: string
): Suggestion | null {
	if (!about.span)
		return about.path ? { kind: 'review', path: about.path, side: 'new', body } : null;
	const found = findHunk(files, about.span.hunk);
	// ponytail: a unified pick across removed and added lines comments on one side only,
	// GitHub's startSide LEFT with side RIGHT would cover both
	const at = found && spanNumbers(found.hunk, about.span);
	if (!found || !at) return null;
	return {
		kind: 'review',
		path: found.file.newPath,
		side: at.side,
		line: at.last,
		...(at.first < at.last && { startLine: at.first }),
		body
	};
}
