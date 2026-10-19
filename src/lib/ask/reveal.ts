import { createMarkdown } from '$lib/markdown';

/**
 * An answer as it streams in: how much of what has arrived is on screen. It shows at a
 * pace a person can read, whole words at a time, and never stops inside a markdown
 * construct that isn't finished, an unclosed `**`, a link without its target, a table row.
 */
export interface Reveal {
	/** what had arrived when it last moved */
	source: string;
	/** how much of it is on screen */
	shown: number;
	/** characters a second */
	rate: number;
	/** what earlier frames didn't spend, saved up for a piece bigger than one frame's worth */
	carry: number;
	/** nothing more to show until more arrives, or ever, once the stream is over */
	idle: boolean;
}

/** about the pace of skimming, it never goes slower */
const BASE = 90;
/** the fastest it goes while the answer streams */
const CEILING = 900;
/** it aims to clear its backlog in this many seconds, the rate easing toward that */
const CATCH_UP = 1.5;
const EASE = 0.6;
/** once the stream ends, what's left shows within this many seconds */
const FLUSH = 0.25;
/** a frame after a stall, like a hidden tab, counts as no longer than this */
const MAX_FRAME = 0.05;

/** `finished`: it's in already, a saved answer, shown whole at once */
export const startReveal = (source: string, finished: boolean): Reveal => ({
	source,
	shown: finished ? source.length : 0,
	rate: BASE,
	carry: 0,
	idle: finished
});

/**
 * Moves the reveal on by a frame of `ms`. While `streaming`, it stops short of what's
 * unfinished; after, what's left shows quickly. `reduced` shows all it can at once.
 */
export function advance(
	r: Reveal,
	source: string,
	streaming: boolean,
	ms: number,
	reduced = false
): Reveal {
	let shown = r.shown;
	// a retry clears the text, and the saved answer can differ from what streamed: start
	// over while it streams, show it whole once it's in rather than type it again
	if (!source.startsWith(r.source.slice(0, shown))) shown = streaming ? 0 : source.length;
	const limit = streaming ? stableLength(source) : source.length;
	let next: number | null;

	if (reduced) {
		while ((next = nextStop(source, shown, streaming, limit)) !== null) shown = next;
		return { source, shown, rate: r.rate, carry: 0, idle: true };
	}

	const dt = Math.min(ms / 1000, MAX_FRAME);
	const backlog = Math.max(0, limit - shown);
	let rate = r.rate;
	if (streaming) {
		const aim = Math.min(CEILING, Math.max(BASE, backlog / CATCH_UP));
		rate += (aim - rate) * Math.min(1, dt / EASE);
	} else {
		rate = Math.max(rate, backlog / FLUSH);
	}
	let budget = r.carry + rate * dt;
	while ((next = nextStop(source, shown, streaming, limit)) !== null && next - shown <= budget) {
		budget -= next - shown;
		shown = next;
	}
	// idle time doesn't save up into a burst, only a piece too big for one frame does
	return { source, shown, rate, carry: next === null ? 0 : budget, idle: next === null };
}

/** The next place after `from` the reveal can stop at: after a word, where nothing's half done. */
function nextStop(text: string, from: number, streaming: boolean, limit: number): number | null {
	let p = from;
	while (p < limit) {
		while (p < text.length && /\s/.test(text[p])) p++;
		while (p < text.length && !/\s/.test(text[p])) p++;
		// a line's end is a stop too, before the next line's indent
		while (p < text.length && (text[p] === ' ' || text[p] === '\t')) p++;
		if (text[p] === '\n') p++;
		if (p > limit) return null;
		if (!streaming && p === text.length) return p;
		if (stableLength(text, p) === p) return p;
	}
	return null;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
/** a line that starts a list item, heading or quote: emphasis doesn't carry into it */
const MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)]|#{1,6}|>)(?:\s|$)/;
/** a line with only a marker so far, or a rule or heading underline on its way */
const BARE = /^ {0,3}(?:[-*+=_]+|\d{1,9}[.)]|#{1,6}|>+)?\s*$/;
const SEPARATOR = /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
/** what a table's separator line can start as */
const MAYBE_SEPARATOR = /^[\s|:-]*$/;

/**
 * How much of `text`, up to `end`, can show while more is on its way: whole words, whole
 * lines in a code block and a table, and nothing from an unclosed `**`, `` ` ``, `[` or
 * fence on. Inline marks only count in the block the text ends in, they can't span blocks.
 */
export function stableLength(text: string, end = text.length): number {
	const s = text.slice(0, end);
	const lines = s.split('\n');
	let at = 0;
	/** where the block the text ends in starts */
	let scope = 0;
	let fence: { char: string; size: number } | null = null;
	let table = false;

	for (let i = 0; i < lines.length - 1; i++) {
		const line = lines[i];
		const next = at + line.length + 1;
		const opening: RegExpExecArray | null = fence ? null : FENCE.exec(line);
		if (fence) {
			const close = FENCE_CLOSE.exec(line);
			if (close && close[1][0] === fence.char && close[1].length >= fence.size) {
				fence = null;
				scope = next;
			}
		} else if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
			fence = { char: opening[1][0], size: opening[1].length };
			table = false;
		} else if (!line.trim()) {
			scope = next;
			table = false;
		} else if (
			table ||
			(line.includes('|') && i + 1 < lines.length - 1 && SEPARATOR.test(lines[i + 1]))
		) {
			// a table's rows are lines of their own
			table = line.includes('|');
			scope = table ? next : at;
		} else if (/^ {0,3}#{1,6}(\s|$)/.test(line)) {
			scope = next;
		} else if (MARKER.test(line)) {
			scope = at;
		}
		at = next;
	}

	const tail = lines.at(-1)!;
	if (fence) return at;
	// a header waiting on its separator, it shows with it as a table, never as pipes first
	const header = lines.at(-2);
	if (!table && header?.includes('|') && MAYBE_SEPARATOR.test(tail)) {
		return at - header.length - 1;
	}
	if (
		table ||
		tail.includes('|') ||
		/^ {0,3}(`{2,}|~{2,})/.test(tail) ||
		(/\S/.test(tail) && BARE.test(tail))
	) {
		return at;
	}
	if (MARKER.test(tail)) scope = at;

	let cut = backToWord(s, s.length);
	const open = unclosed(s.slice(scope, cut));
	if (open >= 0) cut = backToWord(s, scope + open);
	return cut;
}

/** Back to just after whitespace, so no word shows in part. */
function backToWord(s: string, p: number): number {
	while (p > 0 && !/\s/.test(s[p - 1])) p--;
	return p;
}

const runOf = (s: string, i: number) => {
	let j = i;
	while (s[j] === s[i]) j++;
	return j - i;
};

/** Where the first inline construct still open in `seg` starts, or -1 when all are closed. */
function unclosed(seg: string): number {
	const marks: { char: string; size: number; at: number }[] = [];
	const brackets: number[] = [];
	const earliest = (also = Infinity) => Math.min(also, ...marks.map((m) => m.at), ...brackets);

	for (let i = 0; i < seg.length;) {
		const c = seg[i];
		if (c === '\\') {
			i += 2;
		} else if (c === '`') {
			const size = runOf(seg, i);
			let close = i + size;
			while (close < seg.length && !(seg[close] === '`' && runOf(seg, close) === size)) {
				close += seg[close] === '`' ? runOf(seg, close) : 1;
			}
			if (close >= seg.length) return earliest(i);
			i = close + size;
		} else if (c === '*' || c === '_' || c === '~') {
			const size = runOf(seg, i);
			const before = seg[i - 1] ?? ' ';
			const after = seg[i + size] ?? ' ';
			let opens = !/\s/.test(after);
			let closes = !/\s/.test(before);
			// snake_case and a lone ~ aren't marks
			if ((c === '_' && /\w/.test(before) && /\w/.test(after)) || (c === '~' && size !== 2)) {
				opens = closes = false;
			}
			const open = closes ? marks.findLastIndex((m) => m.char === c && m.size === size) : -1;
			if (open >= 0) marks.splice(open, 1);
			else if (opens) marks.push({ char: c, size, at: i });
			i += size;
		} else if (c === '[') {
			brackets.push(i++);
		} else if (c === ']' && brackets.length) {
			const open = brackets.pop()!;
			// what follows decides whether it's a link
			if (i + 1 >= seg.length) return earliest(open);
			if (seg[i + 1] === '(') {
				const close = seg.indexOf(')', i + 2);
				if (close < 0) return earliest(open);
				i = close + 1;
			} else i++;
		} else i++;
	}
	const at = earliest();
	return at === Infinity ? -1 : at;
}

const md = createMarkdown();

/**
 * The top-level blocks of `markdown`, paragraphs, lists, tables, code blocks, each as its
 * own source. Shown one element each, a finished block stays as it is while the last grows.
 */
export function blocks(markdown: string): string[] {
	const lines = markdown.split('\n');
	return md
		.parse(markdown, {})
		.filter((t) => t.level === 0 && t.nesting !== -1 && t.map)
		.map((t) => lines.slice(t.map![0], t.map![1]).join('\n').replace(/\n+$/, ''));
}

export const renderBlock = (block: string): string => md.render(block);
