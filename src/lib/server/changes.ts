import { isGenerated } from '$lib/diff/path';
import type { ChangeMode, DiffFile, DiffLine, Hunk } from '$lib/diff/types';
import { detectLanguage, tokenRanges, type Language } from './highlight';

/**
 * Finds what actually changed inside the lines git reports as changed. Git
 * stays the backbone (hunks, line numbers, guide ids), this only adds `spans`
 * for the new pieces of a line and flags lines where nothing is new.
 *
 * 1. Tokens: within each block of removed and added lines, twinkleplop's
 *    tokens are compared, so a rename or a changed argument lights up as a
 *    whole token, never half a word. Indentation isn't a token where it
 *    carries no meaning, so a re-indented line has nothing new.
 * 2. Formatting: a file whose code reads the same token for token, context
 *    included, was only reformatted. Only claimed for languages where the
 *    whitespace between tokens means nothing.
 *
 * Moved code stays a removal and an addition, as on GitHub: telling a move
 * from two files sharing a line took more guessing than it was worth. Every
 * false "reformatted" or "formatting only" hides a real change from the
 * reviewer, so when in doubt a line stays a change.
 */

export interface ChangeSummary {
	mode: ChangeMode;
	/** files with nothing new in them */
	formattingOnly: number;
}

export function annotateChanges(files: DiffFile[], mode: ChangeMode): ChangeSummary {
	const summary: ChangeSummary = { mode, formattingOnly: 0 };
	if (mode === 'lines') return summary;

	// lockfiles and the like are noise, comparing their tokens says nothing
	const targets = files.filter((f) => !f.binary && f.hunks.length > 0 && !isGenerated(f));
	for (const file of targets) {
		const lang = detectLanguage(file.newPath);
		for (const hunk of file.hunks) {
			for (const { dels, adds } of blocks(hunk)) {
				// a block that only adds or only removes has nothing to compare
				if (dels.length && adds.length) compare(dels, adds, lang);
			}
		}

		const formattingOnly = onlyWhitespace(file, lang);
		// a reformatted file has nothing new anywhere, even where blocks didn't line up
		if (formattingOnly) for (const line of changedLines(file)) settle(line, []);

		file.changes = { formattingOnly };
		if (formattingOnly) summary.formattingOnly++;
	}
	return summary;
}

// ---------------------------------------------------------------------------
// tokens

// beyond this many comparisons a block keeps whole-line highlighting
const MAX_CELLS = 2_500_000;
const WORD = /[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]/gu;
// inside strings the spaces count too, `"a  b"` isn't `"a b"`
const WORD_OR_SPACE = /[\p{L}\p{N}_$]+|\s+|[^\s\p{L}\p{N}_$]/gu;

interface Piece {
	start: number;
	end: number;
	text: string;
}

// indentation carries meaning here, so re-indenting is a real change
const INDENT_SENSITIVE = new Set<Language>(['python', 'yaml', 'markdown']);
// token types whose inner whitespace is part of the value
const VERBATIM = new Set(['string', 'template', 'regex']);

/** Runs of consecutive changed lines, split into their removed and added lines. */
function blocks(hunk: Hunk): { dels: DiffLine[]; adds: DiffLine[] }[] {
	const out: { dels: DiffLine[]; adds: DiffLine[] }[] = [];
	let current: { dels: DiffLine[]; adds: DiffLine[] } | null = null;
	for (const line of hunk.lines) {
		if (line.kind === 'ctx') {
			current = null;
			continue;
		}
		if (!current) out.push((current = { dels: [], adds: [] }));
		(line.kind === 'del' ? current.dels : current.adds).push(line);
	}
	return out;
}

/** Compares the tokens of removed lines against added lines and settles both. */
function compare(dels: DiffLine[], adds: DiffLine[], lang: Language | null) {
	const indent = lang !== null && INDENT_SENSITIVE.has(lang);
	const a = pieces(dels, lang, indent);
	const b = pieces(adds, lang, indent);
	const [ma, mb] = match(
		a.map((p) => p.text),
		b.map((p) => p.text)
	);
	const la = lineOf(dels, a);
	const lb = lineOf(adds, b);
	const fullA = complete(dels.length, la, ma);
	const fullB = complete(adds.length, lb, mb);
	assign(dels, a, la, ma, lb, fullB);
	assign(adds, b, lb, mb, la, fullA);
}

/**
 * Comparable pieces of lines: twinkleplop's tokens, with tokens that hold
 * whitespace split into words so one changed word in a comment doesn't mark
 * the whole comment. In strings the runs of spaces are pieces too, they're
 * part of the value. `indent` adds each line's indentation as a piece of its
 * own, for languages where it carries meaning.
 */
function pieces(lines: DiffLine[], lang: Language | null, indent = false): Piece[] {
	const text = lines.map((l) => l.text).join('\n');
	let ranges: [number, number, string][] = [];
	if (lang) {
		try {
			ranges = tokenRanges(lang, text);
		} catch {
			ranges = [];
		}
	}

	const out: Piece[] = [];
	const words = (start: number, end: number, pattern = WORD) => {
		for (const m of text.slice(start, end).matchAll(pattern)) {
			const at = start + m.index;
			out.push({ start: at, end: at + m[0].length, text: m[0] });
		}
	};
	let pos = 0;
	for (const [start, end, type] of ranges) {
		if (start < pos) continue;
		words(pos, start);
		const token = text.slice(start, end);
		if (/\s/.test(token)) words(start, end, VERBATIM.has(type) ? WORD_OR_SPACE : WORD);
		else if (token) out.push({ start, end, text: token });
		pos = end;
	}
	words(pos, text.length);

	if (indent) {
		let offset = 0;
		for (const line of lines) {
			const width = line.text.length - line.text.trimStart().length;
			// can't equal a real token, and an unindented line has one too
			out.push({ start: offset, end: offset + width, text: `\0${line.text.slice(0, width)}` });
			offset += line.text.length + 1;
		}
		out.sort((x, y) => x.start - y.start || x.end - y.end);
	}
	return out;
}

/** The line each piece sits on. */
function lineOf(lines: DiffLine[], pieces: Piece[]): Int32Array {
	const out = new Int32Array(pieces.length);
	let li = 0;
	let next = lines[0].text.length + 1;
	pieces.forEach((piece, i) => {
		while (li + 1 < lines.length && piece.start >= next) next += lines[++li].text.length + 1;
		out[i] = li;
	});
	return out;
}

/** Which lines have every piece matched. */
function complete(count: number, line: Int32Array, partner: Int32Array): boolean[] {
	const full = Array<boolean>(count).fill(true);
	partner.forEach((p, i) => {
		if (p < 0) full[line[i]] = false;
	});
	return full;
}

/** Longest common subsequence of two token lists, as each piece's partner on the other side, -1 for none. */
function match(a: string[], b: string[]): [Int32Array, Int32Array] {
	const ma = new Int32Array(a.length).fill(-1);
	const mb = new Int32Array(b.length).fill(-1);
	const pair = (i: number, j: number) => {
		ma[i] = j;
		mb[j] = i;
	};

	let s = 0;
	while (s < a.length && s < b.length && a[s] === b[s]) pair(s, s++);
	let ea = a.length;
	let eb = b.length;
	while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) pair(--ea, --eb);

	const n = ea - s;
	const m = eb - s;
	if (n === 0 || m === 0 || n * m > MAX_CELLS) return [ma, mb];

	const w = m + 1;
	const dp = new Uint32Array((n + 1) * w);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i * w + j] =
				a[s + i] === b[s + j]
					? dp[(i + 1) * w + j + 1] + 1
					: Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
		}
	}
	for (let i = 0, j = 0; i < n && j < m;) {
		if (a[s + i] === b[s + j]) {
			pair(s + i, s + j);
			i++;
			j++;
		} else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
		else j++;
	}
	return [ma, mb];
}

/**
 * Turns pieces (block offsets) into spans on their lines. Unmatched pieces are
 * new. A line matched against several lines of the other side is a re-wrap
 * when those lines matched completely too. When they didn't, the line was
 * stitched together from parts of different lines, and only its main
 * counterpart counts: `if (isAdmin(user)) deny();` built from an admin line
 * and a guest line highlights `deny();`.
 */
function assign(
	lines: DiffLine[],
	pieces: Piece[],
	line: Int32Array,
	partner: Int32Array,
	otherLine: Int32Array,
	otherFull: boolean[]
) {
	const starts: number[] = [];
	let offset = 0;
	for (const l of lines) {
		starts.push(offset);
		offset += l.text.length + 1;
	}

	// per line, how many of its pieces match each line on the other side
	const counts = lines.map(() => new Map<number, number>());
	partner.forEach((p, i) => {
		if (p < 0) return;
		const other = otherLine[p];
		counts[line[i]].set(other, (counts[line[i]].get(other) ?? 0) + 1);
	});
	const main = counts.map((c) => {
		const others = [...c.keys()];
		if (others.length < 2 || others.every((o) => otherFull[o])) return null;
		return others.reduce((best, o) => (c.get(o)! > c.get(best)! ? o : best));
	});

	const spans: [number, number][][] = lines.map(() => []);
	pieces.forEach((piece, i) => {
		const li = line[i];
		const p = partner[i];
		const elsewhere = p >= 0 && main[li] !== null && otherLine[p] !== main[li];
		if (p < 0 || elsewhere) spans[li].push([piece.start - starts[li], piece.end - starts[li]]);
	});
	lines.forEach((l, i) => settle(l, spans[i]));
}

// ---------------------------------------------------------------------------
// formatting

// where whitespace between tokens can change what code does, or no grammar says what a
// token is: shell words, indentation, markdown structure, plain text
const WHITESPACE_MATTERS = new Set<Language>(['bash', 'markdown', 'python', 'yaml']);

/**
 * Every hunk reads the same before and after, token for token, only the
 * whitespace between tokens differs. Context lines count, so code moved past
 * other code isn't formatting, and strings compare whole.
 */
function onlyWhitespace(file: DiffFile, lang: Language | null): boolean {
	if (!lang || WHITESPACE_MATTERS.has(lang)) return false;
	return file.hunks.every((hunk) => {
		const before = hunk.lines.filter((l) => l.kind !== 'add');
		const after = hunk.lines.filter((l) => l.kind !== 'del');
		if (!before.length || !after.length) return false;
		const a = pieces(before, lang).map((p) => p.text);
		const b = pieces(after, lang).map((p) => p.text);
		return a.length === b.length && a.every((t, i) => t === b[i]);
	});
}

// ---------------------------------------------------------------------------
// shared

function changedLines(file: DiffFile): DiffLine[] {
	return file.hunks.flatMap((h) => h.lines.filter((l) => l.kind !== 'ctx'));
}

/**
 * Settles a changed line: nothing new means it was only reformatted,
 * everything new needs no spans since the row colour already says it, and
 * anything in between keeps its spans, merged across whitespace.
 */
function settle(line: DiffLine, spans: [number, number][]) {
	const text = line.text;
	line.spans = undefined;
	if (!text.trim()) return;

	const merged: [number, number][] = [];
	for (const [start, end] of spans.toSorted((x, y) => x[0] - y[0])) {
		const last = merged.at(-1);
		if (last && !text.slice(last[1], start).trim()) last[1] = Math.max(last[1], end);
		else merged.push([start, end]);
	}

	if (merged.length === 0) {
		line.reformatted = true;
		return;
	}
	const visible = (s: string) => s.replace(/\s/g, '').length;
	const covered = merged.reduce((n, [s, e]) => n + visible(text.slice(s, e)), 0);
	if (covered < visible(text)) line.spans = merged;
}
