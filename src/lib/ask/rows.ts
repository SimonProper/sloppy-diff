import type { Cursor } from './threads.svelte';
import { linesOf, type Anchor, type LineSpan, type Side } from './types';

/**
 * The diff's rows carry `data-hunk`, `data-index` and, in split layout,
 * `data-side`. These find lines on the page from a span, and spans from
 * what's on the page: a text selection, or the keyboard cursor.
 */

const sideOf = (el: HTMLElement) => el.dataset.side as Side | undefined;

/** The rendered row of a hunk's line, on `side` where the layout has sides. */
export function rowOf(hunk: string, index: number, side?: Side): HTMLElement | null {
	const base = `[data-hunk="${hunk}"][data-index="${index}"]`;
	return (
		(side && document.querySelector<HTMLElement>(`${base}[data-side="${side}"]`)) ||
		document.querySelector<HTMLElement>(base)
	);
}

export const span = (hunk: string, a: number, b: number, side?: Side): LineSpan => ({
	hunk,
	start: Math.min(a, b),
	end: Math.max(a, b),
	...(side && { side })
});

/**
 * The lines of the text selection, when it lies within one hunk (and one side
 * of it), and where the selection ends on screen.
 */
export function selectedSpan(within?: Element): { span: LineSpan; rect: DOMRect } | null {
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
	const range = selection.getRangeAt(0);
	const cell = (node: Node) =>
		(node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-index]');
	const [a, b] = [cell(range.startContainer), cell(range.endContainer)];
	if (!a || !b || (within && (!within.contains(a) || !within.contains(b)))) return null;
	const hunk = a.dataset.hunk!;
	if (b.dataset.hunk !== hunk || sideOf(a) !== sideOf(b)) return null;
	const side = sideOf(a);

	let last = b;
	// ending at the very start of a line, like after a triple click, selects none of it
	const tail = document.createRange();
	tail.setStart(b, 0);
	tail.setEnd(range.endContainer, range.endOffset);
	if (b !== a && tail.toString() === '') {
		const lines = [
			...document.querySelectorAll<HTMLElement>(
				`[data-hunk="${hunk}"][data-index]${side ? `[data-side="${side}"]` : ''}`
			)
		];
		last = lines[lines.indexOf(b) - 1] ?? b;
	}
	return {
		span: span(hunk, Number(a.dataset.index), Number(last.dataset.index), side),
		rect: range.getBoundingClientRect()
	};
}

/** What the page header and the sticky bars cover at the top. */
const COVERED = 140;

/** The rows the cursor moves over, in page order: every line, or one side's. */
function rows(side?: Side): HTMLElement[] {
	return [
		...document.querySelectorAll<HTMLElement>(
			`main [data-index]${side ? `[data-side="${side}"]` : ''}`
		)
	];
}

const split = () => document.querySelector('main [data-side]') !== null;

/** Where keyboard picking starts: the first changed line in view, else the first line in view. */
export function startCursor(): Cursor | null {
	const side: Side | undefined = split() ? 'new' : undefined;
	const visible = rows(side).filter((el) => {
		const { top, bottom } = el.getBoundingClientRect();
		return top >= COVERED && bottom <= window.innerHeight;
	});
	const row =
		visible.find((el) => el.classList.contains('add') || el.classList.contains('del')) ??
		visible[0];
	if (!row) return null;
	const index = Number(row.dataset.index);
	return { hunk: row.dataset.hunk!, head: index, anchor: index, side };
}

/** The cursor one line up or down, `extend` keeps the pick's start and stays in the hunk. */
export function moveCursor(cursor: Cursor, delta: 1 | -1, extend: boolean): Cursor {
	const list = rows(cursor.side);
	const at = list.indexOf(rowOf(cursor.hunk, cursor.head, cursor.side)!);
	const next = at < 0 ? undefined : list[at + delta];
	if (!next || (extend && next.dataset.hunk !== cursor.hunk)) return cursor;
	next.scrollIntoView({ block: 'nearest' });
	const index = Number(next.dataset.index);
	return {
		...cursor,
		hunk: next.dataset.hunk!,
		head: index,
		anchor: extend ? cursor.anchor : index
	};
}

/** The cursor on the other side of a split row, where that side has a line. */
export function switchSide(cursor: Cursor): Cursor {
	if (!cursor.side) return cursor;
	const other: Side = cursor.side === 'old' ? 'new' : 'old';
	const row = rowOf(cursor.hunk, cursor.head, cursor.side)?.parentElement;
	const cell = row?.querySelector<HTMLElement>(`[data-index][data-side="${other}"]`);
	if (!cell) return cursor;
	const index = Number(cell.dataset.index);
	return { hunk: cursor.hunk, head: index, anchor: index, side: other };
}

/** Scrolls the diff to a span's lines and flashes them, rendering them first if they're far off. */
export async function reveal(target: LineSpan) {
	let row = rowOf(target.hunk, target.start, target.side);
	if (!row) {
		// a virtualised diff renders the lines once their hunk is near
		document.querySelector(`[data-hunk-top="${target.hunk}"]`)?.scrollIntoView({ block: 'center' });
		for (let i = 0; i < 20 && !row; i++) {
			await new Promise(requestAnimationFrame);
			row = rowOf(target.hunk, target.start, target.side);
		}
	}
	if (!row) return;
	row.scrollIntoView({ block: 'center' });
	for (const el of document.querySelectorAll<HTMLElement>(
		`[data-hunk="${target.hunk}"][data-index]`
	)) {
		const index = Number(el.dataset.index);
		if (index < target.start || index > target.end) continue;
		if (target.side && sideOf(el) && sideOf(el) !== target.side) continue;
		el.classList.remove('flash');
		void el.offsetWidth;
		el.classList.add('flash');
		setTimeout(() => el.classList.remove('flash'), 900);
	}
}

/** Scrolls to a question's lines, or the file of a question about a whole file. */
export function revealAnchor(anchor: Anchor) {
	const lines = linesOf(anchor);
	if (lines) return reveal(lines);
	if (anchor.path) {
		document
			.querySelector(`[data-path="${CSS.escape(anchor.path)}"]`)
			?.scrollIntoView({ block: 'start' });
	}
}
