import { untrack } from 'svelte';
import type { Hunk } from '$lib/diff/types';

/**
 * Finding text in the diffs, in place of the browser's find: only lines near the screen
 * exist on the page, the browser can't see the rest. Searched in the diff itself, marked
 * with CSS highlights, which colour text without touching the lines.
 */

/** a file on the page, registered by FileDiff */
export interface Source {
	/** its element, for the order files are in on the page */
	el: HTMLElement;
	hunks: () => Hunk[];
	/** opens the file and renders the line, scrolled into view, returns its row */
	reveal: (hunk: string, index: number) => Promise<Element | null>;
}

export interface Match {
	source: Source;
	hunk: string;
	/** the line's index in its hunk */
	index: number;
	/** which match in the line it is */
	nth: number;
}

export const find = $state({ open: false, query: '', sources: 0 });

const sources = new Set<Source>();

export function register(source: Source) {
	// registered from an effect, which mustn't depend on the count it bumps
	const changed = () => untrack(() => find.sources++);
	sources.add(source);
	changed();
	return () => {
		sources.delete(source);
		changed();
	};
}

/** Puts a line on the page, its file opened and rendered, wherever it is; returns its row. */
export async function revealLine(hunk: string, index: number) {
	for (const source of sources)
		if (source.hunks().some((h) => h.id === hunk)) return source.reveal(hunk, index);
	return null;
}

/** where `query` is in `text`, ignoring case unless the query has capitals */
export function occurrences(text: string, query: string): number[] {
	if (!query) return [];
	const caseless = query === query.toLowerCase();
	const haystack = caseless ? text.toLowerCase() : text;
	const at: number[] = [];
	for (let i = haystack.indexOf(query); i !== -1; i = haystack.indexOf(query, i + query.length))
		at.push(i);
	return at;
}

/** every match in the files on the page, in the order they're in */
export function search(query: string): Match[] {
	const ordered = [...sources].sort((a, b) =>
		a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
	);
	const matches: Match[] = [];
	for (const source of ordered)
		for (const hunk of source.hunks())
			hunk.lines.forEach((line, index) => {
				const count = occurrences(line.text, query).length;
				for (let nth = 0; nth < count; nth++) matches.push({ source, hunk: hunk.id, index, nth });
			});
	return matches;
}

// no highlights where the browser hasn't got them, or outside one
const supported = typeof CSS !== 'undefined' && 'highlights' in CSS;
const all = supported ? new Highlight() : null;
const current = supported ? new Highlight() : null;
if (all && current) {
	current.priority = 1;
	CSS.highlights.set('find', all);
	CSS.highlights.set('find-current', current);
}

/** the ranges `query` covers in an element's text, its unselectable notes left out */
function ranges(el: Element, query: string): Range[] {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.parentElement?.closest('.select-none')
				? NodeFilter.FILTER_REJECT
				: NodeFilter.FILTER_ACCEPT
	});
	const nodes: { node: Text; start: number }[] = [];
	let text = '';
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		nodes.push({ node: node as Text, start: text.length });
		text += node.nodeValue;
	}
	const at = (offset: number): [Text, number] => {
		const hit = nodes.findLast((n) => n.start <= offset)!;
		return [hit.node, offset - hit.start];
	};
	return occurrences(text, query).map((start) => {
		const range = new Range();
		range.setStart(...at(start));
		range.setEnd(...at(start + query.length));
		return range;
	});
}

/** marks the matches in a line's code while it's on the page, as an attachment */
export function highlight(el: Element) {
	const query = find.open ? find.query : '';
	if (!all || !query) return;
	const found = ranges(el, query);
	for (const range of found) all.add(range);
	return () => {
		for (const range of found) all.delete(range);
	};
}

/** scrolls to a match and marks it as the one you're on */
export async function show(match: Match) {
	const row = await match.source.reveal(match.hunk, match.index);
	current?.clear();
	const code = row?.querySelector('.text');
	if (!code) return;
	const range = ranges(code, find.query)[match.nth];
	if (range) current?.add(range);
	row!.scrollIntoView({ block: 'center' });
}

export function clearCurrent() {
	current?.clear();
}
