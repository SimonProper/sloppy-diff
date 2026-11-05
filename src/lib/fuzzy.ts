/**
 * fzf's matching, ported from its source (github.com/junegunn/fzf, src/algo/algo.go and
 * src/pattern.go, MIT, © Junegunn Choi): the algorithm telescope-fzf-native ports to C too.
 * Its scores, so results rank as they do in fzf, and the positions matched, to highlight them.
 *
 * Fuzzy terms use fzf's V2, a modified Smith-Waterman that finds the best placement of the
 * query's characters rather than the first: points for each match, a penalty for gaps, more
 * for word boundaries, camelCase and digits, runs and the first character. A query is fzf's
 * extended syntax: space-separated terms all match, `'exact`, `'boundary'`, `^prefix`,
 * `suffix$`, `^equal$`, `!not`, and `a | b` for either. Smart case: a capital makes a term
 * case-sensitive.
 *
 * Left out: fzf's fast paths for one or two characters and its greedy fallback for very long
 * text (the same results, sooner), searching backwards, and folding accents (`normalize`).
 * Positions are UTF-16 indexes into the text, as JavaScript slices it.
 */

const SCORE_MATCH = 16;
const SCORE_GAP_START = -3;
const SCORE_GAP_EXTENSION = -1;
/** cancelled out once the gap between acronym letters grows past 8, fzf's reasoning */
const BONUS_BOUNDARY = SCORE_MATCH / 2;
const BONUS_NON_WORD = SCORE_MATCH / 2;
const BONUS_CAMEL_123 = BONUS_BOUNDARY + SCORE_GAP_EXTENSION;
const BONUS_CONSECUTIVE = -(SCORE_GAP_START + SCORE_GAP_EXTENSION);
const BONUS_FIRST_CHAR_MULTIPLIER = 2;
/** fzf's default scheme: a boundary after whitespace or at the start counts most */
const BONUS_BOUNDARY_WHITE = BONUS_BOUNDARY + 2;
const BONUS_BOUNDARY_DELIMITER = BONUS_BOUNDARY + 1;

const enum Class {
	White,
	NonWord,
	Delimiter,
	Lower,
	Upper,
	Letter,
	Number
}

const DELIMITERS = '/,:;|';
const WHITE = ' \t\n\v\f\r\x85\xA0';

function classOf(char: string): Class {
	if (char >= 'a' && char <= 'z') return Class.Lower;
	if (char >= 'A' && char <= 'Z') return Class.Upper;
	if (char >= '0' && char <= '9') return Class.Number;
	if (WHITE.includes(char)) return Class.White;
	if (DELIMITERS.includes(char)) return Class.Delimiter;
	if (char.charCodeAt(0) < 128) return Class.NonWord;
	if (/\p{Ll}/u.test(char)) return Class.Lower;
	if (/\p{Lu}/u.test(char)) return Class.Upper;
	if (/\p{N}/u.test(char)) return Class.Number;
	if (/\p{L}/u.test(char)) return Class.Letter;
	if (/\s/u.test(char)) return Class.White;
	return Class.NonWord;
}

function bonusFor(prev: Class, cls: Class): number {
	if (cls >= Class.NonWord) {
		if (prev === Class.White) return BONUS_BOUNDARY_WHITE;
		if (prev === Class.Delimiter) return BONUS_BOUNDARY_DELIMITER;
		if (prev === Class.NonWord) return BONUS_BOUNDARY;
	}
	if (
		(prev === Class.Lower && cls === Class.Upper) ||
		(prev !== Class.Number && cls === Class.Number)
	) {
		return BONUS_CAMEL_123;
	}
	if (cls === Class.NonWord || cls === Class.Delimiter) return BONUS_NON_WORD;
	if (cls === Class.White) return BONUS_BOUNDARY_WHITE;
	return 0;
}

function bonusAt(text: string, i: number): number {
	return i === 0 ? BONUS_BOUNDARY_WHITE : bonusFor(classOf(text[i - 1]), classOf(text[i]));
}

/** a single code unit lowercased, kept as it is where lowercasing would make it two */
function lower(char: string): string {
	const low = char.toLowerCase();
	return low.length === 1 ? low : char;
}

const same = (char: string, p: string, caseSensitive: boolean) =>
	char === p || (!caseSensitive && lower(char) === p);

export interface Match {
	start: number;
	end: number;
	score: number;
	/** the matched characters, in order */
	positions: number[];
}

/**
 * Where the pattern could match at all: from just before its first character's first
 * occurrence, for that one's bonus, to after its last character's last. Null when it can't.
 */
function scope(text: string, pattern: string, caseSensitive: boolean): [number, number] | null {
	let first = 0;
	let at = 0;
	let last = 0;
	for (let p = 0; p < pattern.length; p++) {
		while (at < text.length && !same(text[at], pattern[p], caseSensitive)) at++;
		if (at === text.length) return null;
		if (p === 0 && at > 0) first = at - 1;
		last = at++;
	}
	const final = pattern[pattern.length - 1];
	for (let end = text.length - 1; end > last; end--) {
		if (same(text[end], final, caseSensitive)) return [first, end + 1];
	}
	return [first, last + 1];
}

/** fzf's FuzzyMatchV2. `pattern` lowercase unless case-sensitive. */
export function fuzzyMatchV2(caseSensitive: boolean, text: string, pattern: string): Match | null {
	const M = pattern.length;
	if (M === 0) return { start: 0, end: 0, score: 0, positions: [] };
	if (M > text.length) return null;

	// Phase 1. Where it can match
	const found = scope(text, pattern, caseSensitive);
	if (!found) return null;
	const [minIdx, maxIdx] = found;
	const N = maxIdx - minIdx;

	const H0 = new Int32Array(N);
	const C0 = new Int32Array(N);
	/** the bonus at each position */
	const B = new Int32Array(N);
	/** the first occurrence of each character of the pattern */
	const F = new Int32Array(M);
	const T = text.slice(minIdx, maxIdx).split('');

	// Phase 2. Bonus for each position, and the first row of scores
	let maxScore = 0;
	let maxScorePos = 0;
	let pidx = 0;
	let lastIdx = 0;
	const pchar0 = pattern[0];
	let pchar = pattern[0];
	let prevH0 = 0;
	let prevClass = Class.White;
	let inGap = false;
	for (let off = 0; off < N; off++) {
		let char = T[off];
		const cls = classOf(char);
		if (!caseSensitive && cls === Class.Upper) T[off] = char = lower(char);
		const bonus = bonusFor(prevClass, cls);
		B[off] = bonus;
		prevClass = cls;

		if (char === pchar) {
			if (pidx < M) {
				F[pidx] = off;
				pidx++;
				pchar = pattern[Math.min(pidx, M - 1)];
			}
			lastIdx = off;
		}

		if (char === pchar0) {
			const score = SCORE_MATCH + bonus * BONUS_FIRST_CHAR_MULTIPLIER;
			H0[off] = score;
			C0[off] = 1;
			if (M === 1 && score > maxScore) {
				maxScore = score;
				maxScorePos = off;
				if (bonus >= BONUS_BOUNDARY) break;
			}
			inGap = false;
		} else {
			H0[off] = Math.max(prevH0 + (inGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START), 0);
			C0[off] = 0;
			inGap = true;
		}
		prevH0 = H0[off];
	}
	if (pidx !== M) return null;
	if (M === 1) {
		const at = minIdx + maxScorePos;
		return { start: at, end: at + 1, score: maxScore, positions: [at] };
	}

	// Phase 3. The score matrix, one row per character of the pattern. Unlike Smith-Waterman,
	// no character may be left out
	const f0 = F[0];
	const width = lastIdx - f0 + 1;
	const H = new Int32Array(width * M);
	H.set(H0.subarray(f0, lastIdx + 1));
	/** how long a run of matches ends at each position */
	const C = new Int32Array(width * M);
	C.set(C0.subarray(f0, lastIdx + 1));

	for (let row = 1; row < M; row++) {
		const f = F[row];
		const p = pattern[row];
		const base = row * width;
		inGap = false;
		H[base + f - f0 - 1] = 0;
		for (let col = f; col <= lastIdx; col++) {
			const o = col - f0;
			let s1 = 0;
			let consecutive = 0;
			const s2: number = H[base + o - 1] + (inGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START);
			if (p === T[col]) {
				s1 = H[base - width + o - 1] + SCORE_MATCH;
				let b = B[col];
				consecutive = C[base - width + o - 1] + 1;
				if (consecutive > 1) {
					const fb = B[col - consecutive + 1];
					// a boundary breaks the run
					if (b >= BONUS_BOUNDARY && b > fb) consecutive = 1;
					else b = Math.max(b, BONUS_CONSECUTIVE, fb);
				}
				if (s1 + b < s2) {
					s1 += B[col];
					consecutive = 0;
				} else s1 += b;
			}
			C[base + o] = consecutive;
			inGap = s1 < s2;
			const score = Math.max(s1, s2, 0);
			if (row === M - 1 && score > maxScore) {
				maxScore = score;
				maxScorePos = col;
			}
			H[base + o] = score;
		}
	}

	// Phase 4. Back through the matrix for the positions
	const positions: number[] = [];
	let i = M - 1;
	let j = maxScorePos;
	let preferMatch = true;
	for (;;) {
		const I = i * width;
		const j0 = j - f0;
		const s = H[I + j0];
		const s1 = i > 0 && j >= F[i] ? H[I - width + j0 - 1] : 0;
		const s2 = j > F[i] ? H[I + j0 - 1] : 0;
		const row = i;
		if (s > s1 && (s > s2 || (s === s2 && preferMatch))) {
			positions.push(j + minIdx);
			if (i === 0) break;
			i--;
		}
		// the row below is only written from column F[row + 1]
		preferMatch =
			C[I + j0] > 1 ||
			(row + 1 < M && j < lastIdx && j + 1 >= F[row + 1] && C[I + width + j0 + 1] > 0);
		j--;
	}
	return {
		start: minIdx + j,
		end: minIdx + maxScorePos + 1,
		score: maxScore,
		positions: positions.reverse()
	};
}

/** fzf's score of the pattern matched at exactly [start, end), for its exact kinds of match. */
function calculateScore(
	caseSensitive: boolean,
	text: string,
	pattern: string,
	start: number,
	end: number
): number {
	let pidx = 0;
	let score = 0;
	let inGap = false;
	let consecutive = 0;
	let firstBonus = 0;
	let prevClass = start > 0 ? classOf(text[start - 1]) : Class.White;
	for (let idx = start; idx < end; idx++) {
		const cls = classOf(text[idx]);
		const char = caseSensitive ? text[idx] : lower(text[idx]);
		if (char === pattern[pidx]) {
			score += SCORE_MATCH;
			let bonus = bonusFor(prevClass, cls);
			if (consecutive === 0) firstBonus = bonus;
			else {
				if (bonus >= BONUS_BOUNDARY && bonus > firstBonus) firstBonus = bonus;
				bonus = Math.max(bonus, firstBonus, BONUS_CONSECUTIVE);
			}
			score += pidx === 0 ? bonus * BONUS_FIRST_CHAR_MULTIPLIER : bonus;
			inGap = false;
			consecutive++;
			pidx++;
		} else {
			score += inGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START;
			inGap = true;
			consecutive = 0;
			firstBonus = 0;
		}
		prevClass = cls;
	}
	return score;
}

const range = (start: number, end: number) =>
	Array.from({ length: end - start }, (_, i) => start + i);

/** fzf's ExactMatchNaive, or ExactMatchBoundary with `boundary`: the occurrence at the best boundary. */
export function exactMatch(
	caseSensitive: boolean,
	text: string,
	pattern: string,
	boundary = false
): Match | null {
	const M = pattern.length;
	const N = text.length;
	if (M === 0) return { start: 0, end: 0, score: 0, positions: [] };
	if (N < M || !scope(text, pattern, caseSensitive)) return null;

	// for simplicity, only the bonus at the first character counts, as fzf has it
	let pidx = 0;
	let bestPos = -1;
	let bonus = 0;
	let boundaryBonus = 0;
	let bestBonus = -1;
	for (let index = 0; index < N; index++) {
		let ok = same(text[index], pattern[pidx], caseSensitive);
		if (ok) {
			if (pidx === 0) bonus = bonusAt(text, index);
			if (boundary) {
				if (pidx === 0) boundaryBonus = bonus;
				ok = boundaryBonus >= BONUS_BOUNDARY;
				if (ok && pidx === 0) ok = index === 0 || classOf(text[index - 1]) <= Class.Delimiter;
				if (ok && pidx === M - 1) {
					ok = index === N - 1 || classOf(text[index + 1]) <= Class.Delimiter;
				}
			}
		}
		if (ok) {
			pidx++;
			if (pidx === M) {
				if (bonus > bestBonus) {
					bestPos = index;
					bestBonus = bonus;
				}
				if (bonus >= BONUS_BOUNDARY) break;
				index -= pidx - 1;
				pidx = 0;
				bonus = 0;
			}
		} else {
			index -= pidx;
			pidx = 0;
			bonus = 0;
		}
	}
	if (bestPos < 0) return null;
	const start = bestPos - M + 1;
	const end = bestPos + 1;
	let score: number;
	if (boundary) {
		// underscores rank below the other kinds of boundary
		score = bonus;
		let deduct = bonus - BONUS_BOUNDARY + 1;
		if (start > 0 && text[start - 1] === '_') {
			score -= deduct + 1;
			deduct = 1;
		}
		if (end < N && text[end] === '_') score -= deduct;
		// a base, so it can compete with the other kinds of match, e.g. 'foo' | bar
		score += SCORE_MATCH * M + BONUS_BOUNDARY_WHITE * (M + 1);
	} else score = calculateScore(caseSensitive, text, pattern, start, end);
	return { start, end, score, positions: range(start, end) };
}

const leading = (text: string) => text.length - text.trimStart().length;
const trailing = (text: string) => text.length - text.trimEnd().length;
const space = (char: string) => /\s/.test(char);

function matchesAt(caseSensitive: boolean, text: string, pattern: string, at: number) {
	for (let i = 0; i < pattern.length; i++) {
		const char = text[at + i];
		if ((caseSensitive ? char : lower(char)) !== pattern[i]) return false;
	}
	return true;
}

/** fzf's PrefixMatch, after the text's leading whitespace unless the pattern starts with some. */
export function prefixMatch(caseSensitive: boolean, text: string, pattern: string): Match | null {
	const M = pattern.length;
	if (M === 0) return { start: 0, end: 0, score: 0, positions: [] };
	const trimmed = space(pattern[0]) ? 0 : leading(text);
	if (text.length - trimmed < M || !matchesAt(caseSensitive, text, pattern, trimmed)) return null;
	const score = calculateScore(caseSensitive, text, pattern, trimmed, trimmed + M);
	return { start: trimmed, end: trimmed + M, score, positions: range(trimmed, trimmed + M) };
}

/** fzf's SuffixMatch, before the text's trailing whitespace unless the pattern ends with some. */
export function suffixMatch(caseSensitive: boolean, text: string, pattern: string): Match | null {
	const M = pattern.length;
	const trimmed = text.length - (M === 0 || !space(pattern[M - 1]) ? trailing(text) : 0);
	if (M === 0) return { start: trimmed, end: trimmed, score: 0, positions: [] };
	const start = trimmed - M;
	if (start < 0 || !matchesAt(caseSensitive, text, pattern, start)) return null;
	const score = calculateScore(caseSensitive, text, pattern, start, trimmed);
	return { start, end: trimmed, score, positions: range(start, trimmed) };
}

/** fzf's EqualMatch: all of the text, whitespace around it aside. */
export function equalMatch(caseSensitive: boolean, text: string, pattern: string): Match | null {
	const M = pattern.length;
	if (M === 0) return null;
	const start = space(pattern[0]) ? 0 : leading(text);
	const end = text.length - (space(pattern[M - 1]) ? 0 : trailing(text));
	if (end - start !== M || !matchesAt(caseSensitive, text, pattern, start)) return null;
	const score =
		(SCORE_MATCH + BONUS_BOUNDARY_WHITE) * M +
		(BONUS_FIRST_CHAR_MULTIPLIER - 1) * BONUS_BOUNDARY_WHITE;
	return { start, end: start + M, score, positions: range(start, start + M) };
}

type Kind = 'fuzzy' | 'exact' | 'boundary' | 'prefix' | 'suffix' | 'equal';

interface Term {
	kind: Kind;
	/** matches when the text doesn't */
	inverse: boolean;
	text: string;
	caseSensitive: boolean;
}

const MATCHERS: Record<
	Kind,
	(caseSensitive: boolean, text: string, pattern: string) => Match | null
> = {
	fuzzy: fuzzyMatchV2,
	exact: (cs, text, p) => exactMatch(cs, text, p),
	boundary: (cs, text, p) => exactMatch(cs, text, p, true),
	prefix: prefixMatch,
	suffix: suffixMatch,
	equal: equalMatch
};

/** fzf's parseTerms: the query's terms, each set of them one that has to match, any one of it. */
export function parseQuery(query: string): Term[][] {
	const tokens = query.replaceAll('\\ ', '\t').split(/ +/);
	const sets: Term[][] = [];
	let set: Term[] = [];
	let switchSet = false;
	let afterBar = false;
	for (const token of tokens) {
		let kind: Kind = 'fuzzy';
		let inverse = false;
		let text = token.replaceAll('\t', ' ');
		const lowered = text.toLowerCase();
		// smart case
		const caseSensitive = text !== lowered;
		if (!caseSensitive) text = lowered;

		if (set.length && !afterBar && text === '|') {
			switchSet = false;
			afterBar = true;
			continue;
		}
		afterBar = false;

		if (text.startsWith('!')) {
			inverse = true;
			kind = 'exact';
			text = text.slice(1);
		}
		if (text !== '$' && text.endsWith('$')) {
			kind = 'suffix';
			text = text.slice(0, -1);
		}
		if (text.length > 2 && text.startsWith("'") && text.endsWith("'")) {
			kind = 'boundary';
			text = text.slice(1, -1);
		} else if (text.startsWith("'")) {
			// flips exactness
			kind = inverse ? 'fuzzy' : 'exact';
			text = text.slice(1);
		} else if (text.startsWith('^')) {
			kind = kind === 'suffix' ? 'equal' : 'prefix';
			text = text.slice(1);
		}

		if (text.length) {
			if (switchSet) {
				sets.push(set);
				set = [];
			}
			set.push({ kind, inverse, text, caseSensitive });
			switchSet = true;
		}
	}
	if (set.length) sets.push(set);
	return sets;
}

/**
 * The query as fzf reads it, to match texts with: the total of its terms' scores and every
 * position they matched, sorted, or null when it doesn't match. An empty query matches
 * everything, scoring 0.
 */
export function fzf(
	query: string
): (text: string) => { score: number; positions: number[] } | null {
	const sets = parseQuery(query);
	return (text) => {
		let total = 0;
		const positions = new Set<number>();
		for (const set of sets) {
			let matched = false;
			let score = 0;
			for (const term of set) {
				const found = MATCHERS[term.kind](term.caseSensitive, text, term.text);
				if (found) {
					if (term.inverse) continue;
					score = found.score;
					for (const p of found.positions) positions.add(p);
					matched = true;
					break;
				} else if (term.inverse) {
					score = 0;
					matched = true;
				}
			}
			if (!matched) return null;
			total += score;
		}
		return { score: total, positions: [...positions].sort((a, b) => a - b) };
	};
}
