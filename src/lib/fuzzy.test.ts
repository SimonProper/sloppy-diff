import { describe, expect, it } from 'vitest';
import {
	exactMatch,
	fuzzyMatchV2,
	fzf,
	parseQuery,
	prefixMatch,
	suffixMatch,
	type Match
} from './fuzzy';

// fzf's own cases, from src/algo/algo_test.go, with its constants for the scores they expect
const scoreMatch = 16;
const scoreGapStart = -3;
const scoreGapExtension = -1;
const bonusBoundary = scoreMatch / 2;
const bonusNonWord = scoreMatch / 2;
const bonusCamel123 = bonusBoundary + scoreGapExtension;
const bonusConsecutive = -(scoreGapStart + scoreGapExtension);
const bonusFirstCharMultiplier = 2;
const bonusBoundaryWhite = bonusBoundary + 2;
const bonusBoundaryDelimiter = bonusBoundary + 1;

type Fn = (caseSensitive: boolean, text: string, pattern: string) => Match | null;

/** as fzf's assertMatch: where the positions start and end, and the score; -1, -1, 0 for none */
function assertMatch(
	fn: Fn,
	caseSensitive: boolean,
	input: string,
	pattern: string,
	sidx: number,
	eidx: number,
	score: number
) {
	const found = fn(caseSensitive, input, caseSensitive ? pattern : pattern.toLowerCase());
	const got = !found
		? [-1, -1, 0]
		: found.positions.length
			? [found.positions[0], found.positions.at(-1)! + 1, found.score]
			: [found.start, found.end, found.score];
	expect(got, `${input} / ${pattern}`).toEqual([sidx, eidx, score]);
}

describe('fuzzyMatchV2, fzf TestFuzzyMatch', () => {
	const fn = fuzzyMatchV2;
	it('scores as fzf does', () => {
		assertMatch(
			fn,
			false,
			'fooBarbaz1',
			'oBZ',
			2,
			9,
			scoreMatch * 3 + bonusCamel123 + scoreGapStart + scoreGapExtension * 3
		);
		assertMatch(
			fn,
			false,
			'foo bar baz',
			'fbb',
			0,
			9,
			scoreMatch * 3 +
				bonusBoundaryWhite * bonusFirstCharMultiplier +
				bonusBoundaryWhite * 2 +
				2 * scoreGapStart +
				4 * scoreGapExtension
		);
		assertMatch(
			fn,
			false,
			'/AutomatorDocument.icns',
			'rdoc',
			9,
			13,
			scoreMatch * 4 + bonusCamel123 + bonusConsecutive * 2
		);
		assertMatch(
			fn,
			false,
			'/man1/zshcompctl.1',
			'zshc',
			6,
			10,
			scoreMatch * 4 +
				bonusBoundaryDelimiter * bonusFirstCharMultiplier +
				bonusBoundaryDelimiter * 3
		);
		assertMatch(
			fn,
			false,
			'/.oh-my-zsh/cache',
			'zshc',
			8,
			13,
			scoreMatch * 4 +
				bonusBoundary * bonusFirstCharMultiplier +
				bonusBoundary * 2 +
				scoreGapStart +
				bonusBoundaryDelimiter
		);
		assertMatch(
			fn,
			false,
			'.vimrc',
			'.vimrc',
			0,
			6,
			scoreMatch * 6 + bonusBoundaryWhite * (bonusFirstCharMultiplier + 5)
		);
		assertMatch(
			fn,
			false,
			'/.vimrc',
			'.vimrc',
			1,
			7,
			scoreMatch * 6 + bonusBoundaryDelimiter * (bonusFirstCharMultiplier + 5)
		);
		assertMatch(
			fn,
			false,
			'a.vimrc',
			'.vimrc',
			1,
			7,
			scoreMatch * 6 + bonusBoundary * (bonusFirstCharMultiplier + 5)
		);
		assertMatch(
			fn,
			false,
			'ab0123 456',
			'12356',
			3,
			10,
			scoreMatch * 5 + bonusConsecutive * 3 + scoreGapStart + scoreGapExtension
		);
		assertMatch(
			fn,
			false,
			'abc123 456',
			'12356',
			3,
			10,
			scoreMatch * 5 +
				bonusCamel123 * bonusFirstCharMultiplier +
				bonusCamel123 * 2 +
				bonusConsecutive +
				scoreGapStart +
				scoreGapExtension
		);
		assertMatch(
			fn,
			false,
			'foo/bar/baz',
			'fbb',
			0,
			9,
			scoreMatch * 3 +
				bonusBoundaryWhite * bonusFirstCharMultiplier +
				bonusBoundaryDelimiter * 2 +
				2 * scoreGapStart +
				4 * scoreGapExtension
		);
		assertMatch(
			fn,
			false,
			'fooBarBaz',
			'fbb',
			0,
			7,
			scoreMatch * 3 +
				bonusBoundaryWhite * bonusFirstCharMultiplier +
				bonusCamel123 * 2 +
				2 * scoreGapStart +
				2 * scoreGapExtension
		);
		assertMatch(
			fn,
			false,
			'foo barbaz',
			'fbb',
			0,
			8,
			scoreMatch * 3 +
				bonusBoundaryWhite * bonusFirstCharMultiplier +
				bonusBoundaryWhite +
				scoreGapStart * 2 +
				scoreGapExtension * 3
		);
		assertMatch(
			fn,
			false,
			'fooBar Baz',
			'foob',
			0,
			4,
			scoreMatch * 4 + bonusBoundaryWhite * bonusFirstCharMultiplier + bonusBoundaryWhite * 3
		);
		assertMatch(
			fn,
			false,
			'xFoo-Bar Baz',
			'foo-b',
			1,
			6,
			scoreMatch * 5 +
				bonusCamel123 * bonusFirstCharMultiplier +
				bonusCamel123 * 2 +
				bonusNonWord +
				bonusBoundary
		);

		assertMatch(
			fn,
			true,
			'fooBarbaz',
			'oBz',
			2,
			9,
			scoreMatch * 3 + bonusCamel123 + scoreGapStart + scoreGapExtension * 3
		);
		assertMatch(
			fn,
			true,
			'Foo/Bar/Baz',
			'FBB',
			0,
			9,
			scoreMatch * 3 +
				bonusBoundaryWhite * bonusFirstCharMultiplier +
				bonusBoundaryDelimiter * 2 +
				scoreGapStart * 2 +
				scoreGapExtension * 4
		);
		assertMatch(
			fn,
			true,
			'FooBarBaz',
			'FBB',
			0,
			7,
			scoreMatch * 3 +
				bonusBoundaryWhite * bonusFirstCharMultiplier +
				bonusCamel123 * 2 +
				scoreGapStart * 2 +
				scoreGapExtension * 2
		);
		assertMatch(
			fn,
			true,
			'FooBar Baz',
			'FooB',
			0,
			4,
			scoreMatch * 4 +
				bonusBoundaryWhite * bonusFirstCharMultiplier +
				bonusBoundaryWhite * 2 +
				Math.max(bonusCamel123, bonusBoundaryWhite)
		);
		// consecutive bonus updated
		assertMatch(fn, true, 'foo-bar', 'o-ba', 2, 6, scoreMatch * 4 + bonusBoundary * 3);
	});

	it("doesn't match", () => {
		assertMatch(fn, true, 'fooBarbaz', 'oBZ', -1, -1, 0);
		assertMatch(fn, true, 'Foo Bar Baz', 'fbb', -1, -1, 0);
		assertMatch(fn, true, 'fooBarbaz', 'fooBarbazz', -1, -1, 0);
	});

	it('takes the best placement, not the first', () => {
		// the greedy match takes the s of "fix", the run and its boundary win
		expect(fuzzyMatchV2(false, 'fix sidebar spacing', 'side')!.positions).toEqual([4, 5, 6, 7]);
	});
});

describe('exactMatch, fzf TestExactMatchNaive', () => {
	const fn: Fn = (cs, text, p) => exactMatch(cs, text, p);
	it('scores as fzf does', () => {
		assertMatch(fn, true, 'fooBarbaz', 'oBA', -1, -1, 0);
		assertMatch(fn, true, 'fooBarbaz', 'fooBarbazz', -1, -1, 0);
		assertMatch(
			fn,
			false,
			'fooBarbaz',
			'oBA',
			2,
			5,
			scoreMatch * 3 + bonusCamel123 + bonusConsecutive
		);
		assertMatch(
			fn,
			false,
			'/AutomatorDocument.icns',
			'rdoc',
			9,
			13,
			scoreMatch * 4 + bonusCamel123 + bonusConsecutive * 2
		);
		assertMatch(
			fn,
			false,
			'/man1/zshcompctl.1',
			'zshc',
			6,
			10,
			scoreMatch * 4 + bonusBoundaryDelimiter * (bonusFirstCharMultiplier + 3)
		);
		assertMatch(
			fn,
			false,
			'/.oh-my-zsh/cache',
			'zsh/c',
			8,
			13,
			scoreMatch * 5 + bonusBoundary * (bonusFirstCharMultiplier + 3) + bonusBoundaryDelimiter
		);
	});
});

describe('prefixMatch and suffixMatch, fzf TestPrefixMatch and TestSuffixMatch', () => {
	it('scores as fzf does', () => {
		const score =
			scoreMatch * 3 + bonusBoundaryWhite * bonusFirstCharMultiplier + bonusBoundaryWhite * 2;
		assertMatch(prefixMatch, true, 'fooBarbaz', 'Foo', -1, -1, 0);
		assertMatch(prefixMatch, false, 'fooBarBaz', 'baz', -1, -1, 0);
		assertMatch(prefixMatch, false, 'fooBarbaz', 'Foo', 0, 3, score);
		assertMatch(prefixMatch, false, 'foOBarBaZ', 'foo', 0, 3, score);
		assertMatch(prefixMatch, false, 'f-oBarbaz', 'f-o', 0, 3, score);
		assertMatch(prefixMatch, false, ' fooBar', 'foo', 1, 4, score);
		assertMatch(prefixMatch, false, ' fooBar', ' fo', 0, 3, score);
		assertMatch(prefixMatch, false, '     fo', 'foo', -1, -1, 0);

		assertMatch(suffixMatch, true, 'fooBarbaz', 'Baz', -1, -1, 0);
		assertMatch(suffixMatch, false, 'fooBarbaz', 'Foo', -1, -1, 0);
		assertMatch(
			suffixMatch,
			false,
			'fooBarbaz',
			'baz',
			6,
			9,
			scoreMatch * 3 + bonusConsecutive * 2
		);
		assertMatch(
			suffixMatch,
			false,
			'fooBarBaZ',
			'baz',
			6,
			9,
			(scoreMatch + bonusCamel123) * 3 + bonusCamel123 * (bonusFirstCharMultiplier - 1)
		);
		assertMatch(
			suffixMatch,
			false,
			'fooBarbaz ',
			'baz',
			6,
			9,
			scoreMatch * 3 + bonusConsecutive * 2
		);
		assertMatch(
			suffixMatch,
			false,
			'fooBarbaz ',
			'baz ',
			6,
			10,
			scoreMatch * 4 + bonusConsecutive * 2 + bonusBoundaryWhite
		);
	});

	it('matches an empty pattern, as fzf TestEmptyPattern', () => {
		assertMatch(fuzzyMatchV2, true, 'foobar', '', 0, 0, 0);
		assertMatch((cs, t, p) => exactMatch(cs, t, p), true, 'foobar', '', 0, 0, 0);
		assertMatch(prefixMatch, true, 'foobar', '', 0, 0, 0);
		assertMatch(suffixMatch, true, 'foobar', '', 6, 6, 0);
	});
});

describe('the query syntax, as fzf parses it', () => {
	it('reads the kinds of term, smart case and |', () => {
		const kinds = parseQuery("fuz 'ex 'word' ^pre suf$ ^all$ !no Case a | b").map((set) =>
			set.map((t) => `${t.inverse ? '!' : ''}${t.kind}:${t.text}${t.caseSensitive ? ':cs' : ''}`)
		);
		expect(kinds).toEqual([
			['fuzzy:fuz'],
			['exact:ex'],
			['boundary:word'],
			['prefix:pre'],
			['suffix:suf'],
			['equal:all'],
			['!exact:no'],
			['fuzzy:Case:cs'],
			['fuzzy:a', 'fuzzy:b']
		]);
	});

	it('needs every term, any one of an | set, and none of a !', () => {
		const titles = ['Fix the sidebar', 'Sidebar polish', 'Agents view polish', 'README update'];
		const find = (query: string) => {
			const match = fzf(query);
			return titles.filter((t) => match(t));
		};
		expect(find('side pol')).toEqual(['Sidebar polish']);
		expect(find('^side')).toEqual(['Sidebar polish']);
		expect(find('polish$ !agents')).toEqual(['Sidebar polish']);
		expect(find('readme | fix')).toEqual(['Fix the sidebar', 'README update']);
		expect(find("'bar")).toEqual(['Fix the sidebar', 'Sidebar polish']);
		expect(find('SIDE')).toEqual([]);
		expect(find('')).toEqual(titles);
	});
});
