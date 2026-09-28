import { isGenerated } from '$lib/diff/path';
import type { ChangeMode, DiffFile, DiffLine, Hunk } from '$lib/diff/types';
import { detectLanguage, tokenRanges, type Language } from './highlight';

/**
 * Finds what actually changed inside the lines git reports as changed. Git
 * stays the backbone (hunks, line numbers, guide ids), this only adds `spans`
 * for the new pieces of a line and flags lines where nothing is new.
 *
 * 1. Moves: runs of removed and added lines that match anywhere in the diff,
 *    ignoring indentation where it carries no meaning, are moved code. Like
 *    git's --color-moved.
 * 2. Tokens: within each block of removed and added lines, twinkleplop's
 *    tokens are compared, so a rename or a changed argument lights up as a
 *    whole token, never half a word.
 * 3. Formatting: a file whose code reads the same token for token, context
 *    included, was only reformatted. Only claimed for languages where the
 *    whitespace between tokens means nothing.
 *
 * Every false "moved" or "formatting only" hides a real change from the
 * reviewer, so when in doubt a line stays a change.
 */

export interface ChangeSummary {
	mode: ChangeMode;
	/** blocks of code that moved */
	moved: number;
	/** files with nothing new in them */
	formattingOnly: number;
	movedOnly: number;
}

export function annotateChanges(files: DiffFile[], mode: ChangeMode): ChangeSummary {
	const summary: ChangeSummary = { mode, moved: 0, formattingOnly: 0, movedOnly: 0 };
	if (mode === 'lines') return summary;

	// lockfiles and the like are noise, and their repetition is what makes moves expensive
	const targets = files.filter((f) => !f.binary && f.hunks.length > 0 && !isGenerated(f));
	summary.moved = detectMoves(targets);

	for (const file of targets) {
		const lang = detectLanguage(file.newPath);
		for (const hunk of file.hunks) {
			for (const { dels, adds } of blocks(hunk)) {
				// moved lines are settled, and a block that only adds or only removes has nothing to compare
				const a = dels.filter((l) => !l.moved);
				const b = adds.filter((l) => !l.moved);
				if (a.length && b.length) compare(a, b, lang);
			}
		}

		const changed = changedLines(file);
		const quiet = changed.length > 0 && changed.every((l) => l.moved || !l.text.trim());
		const movedOnly = quiet && changed.some((l) => l.moveLabel);
		const formattingOnly = !movedOnly && onlyWhitespace(file, lang);
		// a reformatted file has nothing new anywhere, even where blocks didn't line up
		if (formattingOnly) for (const line of changed) settle(line, []);

		file.changes = { formattingOnly, movedOnly };
		if (formattingOnly) summary.formattingOnly++;
		if (movedOnly) summary.movedOnly++;
	}
	return summary;
}

// ---------------------------------------------------------------------------
// moves

interface Entry {
	line: DiffLine;
	file: DiffFile;
	key: string;
	/** letters and digits, so a block of braces never counts as a move */
	weight: number;
	/** consecutive removed (or added) lines share a run, matches never cross runs */
	run: number;
	/** which change block it sits in */
	block: number;
	/** its place among the block's removed (or added) lines */
	index: number;
	/** part of an import, which moving between files says nothing about */
	import: boolean;
}

// a move needs some substance: two lines with 10 letters or digits, or one with 20
const MIN_WEIGHT_BLOCK = 10;
const MIN_WEIGHT_LINE = 20;
// a line added more often than this (`"dev": true,` in a lockfile) says nothing about
// where it came from, and matching every copy against every other is quadratic
const MAX_COPIES = 8;
// a line that reads almost the same as a line across its own block was edited in place,
// that it also exists somewhere else (markup repeated across components) says nothing
const SIMILAR = 0.6;
// beyond this many lines a move is too long to be a coincidence, and too costly to doubt
const MAX_DOUBTED = 4;

const substantial = (length: number, weight: number) =>
	(length >= 2 && weight >= MIN_WEIGHT_BLOCK) || weight >= MIN_WEIGHT_LINE;

/** Words (letters and digits) of both lines in the same order, weighed by length. */
function similar(a: Entry, b: Entry): boolean {
	const lo = Math.min(a.weight, b.weight);
	const hi = Math.max(a.weight, b.weight);
	if (!lo || (2 * lo) / (lo + hi) < SIMILAR) return false;
	const words = (e: Entry) => e.key.match(/[\p{L}\p{N}]+/gu) ?? [];
	const wa = words(a);
	const [ma] = match(wa, words(b));
	const shared = wa.reduce((sum, w, i) => (ma[i] >= 0 ? sum + w.length : sum), 0);
	return (2 * shared) / (a.weight + b.weight) >= SIMILAR;
}

function detectMoves(files: DiffFile[]): number {
	const dels: Entry[] = [];
	const adds: Entry[] = [];
	let run = 0;
	let block = 0;

	for (const file of files) {
		const lang = detectLanguage(file.newPath);
		// where indentation carries meaning, re-indented code isn't the same code
		const key = (text: string) =>
			lang && INDENT_SENSITIVE.has(lang) ? text.trimEnd() : text.trim();
		for (const hunk of file.hunks) {
			const imported = importLines(hunk, lang);
			let last: DiffLine['kind'] | null = null;
			let index = { del: 0, add: 0 };
			for (const line of hunk.lines) {
				if (line.kind === 'ctx') {
					if (last !== 'ctx') block++;
					index = { del: 0, add: 0 };
				} else {
					if (line.kind !== last) run++;
					const k = key(line.text);
					const entry = {
						line,
						file,
						key: k,
						weight: k.replace(/[^\p{L}\p{N}]/gu, '').length,
						run,
						block,
						index: index[line.kind]++,
						import: imported.has(line)
					};
					(line.kind === 'del' ? dels : adds).push(entry);
				}
				last = line.kind;
			}
			block++;
		}
	}

	const addsByKey = new Map<string, number[]>();
	adds.forEach((entry, i) => {
		if (!entry.weight) return;
		const list = addsByKey.get(entry.key) ?? [];
		list.push(i);
		addsByKey.set(entry.key, list);
	});
	for (const [key, list] of addsByKey) if (list.length > MAX_COPIES) addsByKey.delete(key);

	const before = (list: Entry[], i: number) =>
		i > 0 && list[i - 1].run === list[i].run ? list[i - 1] : null;

	// every maximal run of matching lines, heaviest first
	const candidates: { d: number; a: number; length: number; weight: number }[] = [];
	dels.forEach((del, d) => {
		for (const a of addsByKey.get(del.key) ?? []) {
			const pd = before(dels, d);
			const pa = before(adds, a);
			// not where the run starts, unless the line before can't start one (a blank or `}`)
			if (pd && pa && pd.key === pa.key && pd.weight > 0 && addsByKey.has(pd.key)) continue;

			let length = 0;
			let weight = 0;
			while (
				d + length < dels.length &&
				a + length < adds.length &&
				dels[d + length].run === del.run &&
				adds[a + length].run === adds[a].run &&
				dels[d + length].key === adds[a + length].key
			) {
				weight += dels[d + length].weight;
				length++;
			}
			if (substantial(length, weight)) candidates.push({ d, a, length, weight });
		}
	});
	candidates.sort((x, y) => y.weight - x.weight);

	const byBlock = new Map<number, Entry[]>();
	for (const entry of [...dels, ...adds]) {
		const list = byBlock.get(entry.block) ?? [];
		list.push(entry);
		byBlock.set(entry.block, list);
	}
	const used = new Set<DiffLine>();
	const edited = (entry: Entry) =>
		byBlock
			.get(entry.block)!
			.some((o) => o.line.kind !== entry.line.kind && !used.has(o.line) && similar(entry, o));
	let moves = 0;
	for (const { d, a, length } of candidates) {
		const from = dels.slice(d, d + length);
		const to = adds.slice(a, a + length);
		const both = [...from, ...to];
		if (both.some((e) => used.has(e.line))) continue;
		// a match into another block has to be more than lines edited where they stand, and
		// more than imports: two files using the same thing isn't code going from one to the other
		if (from[0].block !== to[0].block) {
			const across = from[0].file !== to[0].file;
			const short = length <= MAX_DOUBTED;
			const unexplained = (side: Entry[]) => {
				const rest = side.filter((e) => !(across && e.import) && !(short && edited(e)));
				return substantial(
					rest.length,
					rest.reduce((sum, e) => sum + e.weight, 0)
				);
			};
			if (!unexplained(from) || !unexplained(to)) continue;
		}
		for (const entry of both) {
			used.add(entry.line);
			settle(entry.line, []);
		}
		// in the same place of the same block it was re-indented, there's nowhere to point.
		// Anywhere else in the block it changed order, which is a move
		if (from[0].block === to[0].block && from[0].index === to[0].index) continue;
		from[0].line.moveLabel = `moved to ${where(to[0], from[0].file)}`;
		to[0].line.moveLabel = `moved from ${where(from[0], to[0].file)}`;
		moves++;
	}
	return moves;
}

/** "line 12" in the same file, "src/other.ts:12" elsewhere. */
function where(entry: Entry, from: DiffFile): string {
	const number = entry.line.kind === 'del' ? entry.line.old : entry.line.new;
	if (entry.file === from) return `line ${number}`;
	const path = entry.line.kind === 'del' ? entry.file.oldPath : entry.file.newPath;
	return `${path}:${number}`;
}

const JS_IMPORT = /^(import\b|export\b[^=]*\bfrom\s*['"]|(const|let|var)\s[^=]*=\s*require\()/;
/** How an import starts, per language. */
const IMPORTS: Partial<Record<Language, RegExp>> = {
	javascript: JS_IMPORT,
	typescript: JS_IMPORT,
	tsx: JS_IMPORT,
	svelte: JS_IMPORT,
	python: /^(import|from)\s+[\w.]+/,
	go: /^import\b/,
	rust: /^(pub(\([^)]*\))?\s+)?(use|extern\s+crate)\s/,
	css: /^@(import|use|forward)\b/
};

/**
 * The lines of a hunk that are part of an import, one spread over several
 * lines (`import {` up to `} from`) included when the hunk shows where it
 * starts. The old and new side are followed apart, a group can open on one
 * and not the other.
 */
function importLines(hunk: Hunk, lang: Language | null): Set<DiffLine> {
	const out = new Set<DiffLine>();
	const pattern = lang && IMPORTS[lang];
	if (!pattern) return out;
	// brackets an import has left open, per side
	const open = { old: 0, new: 0 };
	for (const line of hunk.lines) {
		const sides =
			line.kind === 'ctx'
				? (['old', 'new'] as const)
				: ([line.kind === 'del' ? 'old' : 'new'] as const);
		const text = line.text.trim();
		for (const side of sides) {
			if (!open[side] && !pattern.test(text)) continue;
			out.add(line);
			open[side] = Math.max(0, open[side] + brackets(text));
		}
	}
	return out;
}

/** Opening brackets less closing ones. */
function brackets(text: string): number {
	let depth = 0;
	for (const c of text) {
		if (c === '{' || c === '(') depth++;
		else if (c === '}' || c === ')') depth--;
	}
	return depth;
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
 * Settles a changed line: nothing new means it only moved or was reformatted,
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
		line.moved = true;
		return;
	}
	const visible = (s: string) => s.replace(/\s/g, '').length;
	const covered = merged.reduce((n, [s, e]) => n + visible(text.slice(s, e)), 0);
	if (covered < visible(text)) line.spans = merged;
}
