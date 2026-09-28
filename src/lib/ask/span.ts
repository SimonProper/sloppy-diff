import type { DiffLine, Hunk } from '$lib/diff/types';
import type { LineSpan, Side } from './types';

/** Whether a line is part of a span, only its side's lines when it has one. */
export function inSpan(span: LineSpan, index: number, line: DiffLine, side?: Side): boolean {
	if (index < span.start || index > span.end) return false;
	if (span.side && side && span.side !== side) return false;
	return span.side === 'old'
		? line.kind !== 'add'
		: span.side === 'new'
			? line.kind !== 'del'
			: true;
}

/** The lines a span covers. */
export function spanLines(hunk: Hunk, span: LineSpan): DiffLine[] {
	return hunk.lines
		.slice(span.start, span.end + 1)
		.filter((l, i) => inSpan(span, span.start + i, l));
}

/** "line 12", "lines 12–15", numbered on the new side unless only removed lines are in it. */
export function spanLabel(hunk: Hunk, span: LineSpan): string {
	const lines = spanLines(hunk, span);
	const side = span.side ?? (lines.some((l) => l.new !== null) ? 'new' : 'old');
	const numbers = lines
		.map((l) => (side === 'old' ? l.old : l.new))
		.filter((n): n is number => n !== null);
	if (numbers.length === 0) return 'no lines';
	const [first, last] = [Math.min(...numbers), Math.max(...numbers)];
	return (
		(first === last ? `line ${first}` : `lines ${first}–${last}`) + (side === 'old' ? ' (old)' : '')
	);
}
