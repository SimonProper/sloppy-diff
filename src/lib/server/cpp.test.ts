import { describe, expect, it } from 'vitest';
import { verify } from '@twinkleplop/core';
import { raw_grammar } from './cpp';
import { tokenRanges } from './highlight';

/** The token types covering the first `piece` in `src`, one per token. */
function typesOf(src: string, piece: string): string[] {
	const at = src.indexOf(piece);
	if (at < 0) throw new Error(`${piece} not in ${src}`);
	return tokenRanges('cpp', src)
		.filter(([start, end]) => start < at + piece.length && end > at)
		.map(([, , type]) => type);
}

describe('cpp grammar', () => {
	it('passes twinkleplop verify', () => {
		expect(verify(raw_grammar)).toEqual([]);
	});

	it.each([
		// preprocessor
		['#include <vector>', '#include', 'directive'],
		['#include <vector>', '<vector>', 'string'],
		['#include "a/b.h"', '"a/b.h"', 'string'],
		['#  include <map>  // std::map', '<map>', 'string'],
		['#includes x', '#includes', 'directive'],
		['#  pragma once', '#  pragma', 'directive'],
		['#define MAX(a, b) ((a) > (b))', 'MAX', 'constant'],
		['#define ID(x) x \\\n  + 1', '1', 'number'],
		['#if defined(FOO) && !BAR', 'defined', 'directive'],
		// comments
		['int a; // trailing "quote\nint b;', '// trailing "quote', 'comment'],
		['int a; // trailing "quote\nint b;', 'b', 'identifier'],
		['// spliced \\\nint b;\nint c;', 'int b;', 'comment'],
		['// spliced \\\nint b;\nint after;', 'after', 'identifier'],
		['/* a\n * b */ int x;', '/* a\n * b */', 'comment'],
		['/* a */ int x;', 'int', 'type'],
		// strings and chars
		['auto s = "a\\"b";', '"a', 'string'],
		['auto s = "a\\"b";', '\\"', 'string_escape'],
		['auto s = "\\x41z";', '\\x41', 'string_escape'],
		['auto s = "\\0123";', '\\012', 'string_escape'],
		['auto s = "\\0123";', '3', 'string'],
		['auto s = u8"x";', 'u8"x"', 'string'],
		['auto s = L"x";', 'L"x"', 'string'],
		["char c = '\\'';", "'", 'string'],
		["char c = '\\n'; int d;", 'd', 'identifier'],
		["auto c = u'x';", "u'x'", 'string'],
		['auto s = "open\nint d;', 'int', 'type'],
		['auto s = "a\\\r\nb"; int q;', 'b"', 'string'],
		['auto s = "a\\\r\nb"; int q;', 'int', 'type'],
		// raw strings
		['auto r = R"(a "quoted" \\n)";', 'R"(a "quoted" \\n)"', 'string'],
		['auto r = R"sql(SELECT ")" )sql"; int z;', 'SELECT ")" )sql"', 'string'],
		['auto r = R"sql(SELECT ")" )sql"; int z;', 'int', 'type'],
		['auto r = R"(line1\nline2)"; int z;', 'line2', 'string'],
		['auto r = R"(a)"; int z;', 'z', 'identifier'],
		['auto r = R"x(f(a))x"; int z;', 'int', 'type'],
		['auto r = u8R"(x)";', 'u8R"(x)"', 'string'],
		['auto r = R"--(a)--";\nint z;', 'int', 'type'],
		['auto r = R"x(a)")x";\nint z;', ')"', 'string'],
		['auto r = R"x(a)")x";\nint z;', 'int', 'type'],
		// numbers
		["auto n = 1'000'000;", "1'000'000", 'number'],
		['auto n = 0xFFull;', '0xFFull', 'number'],
		['auto n = 0b1010;', '0b1010', 'number'],
		['auto n = 1.5e-3f;', '1.5e-3f', 'number'],
		['auto n = .5;', '.5', 'number'],
		['auto n = 10uz;', '10uz', 'number'],
		['auto n = 0xE+1;', '0xE+1', 'number'],
		// words
		['constexpr auto x = nullptr;', 'constexpr', 'keyword'],
		['constexpr auto x = nullptr;', 'nullptr', 'keyword'],
		['bool b = true;', 'true', 'boolean'],
		['unsigned long long n;', 'unsigned', 'type'],
		['std::uint64_t n;', 'uint64_t', 'type'],
		['co_await task();', 'co_await', 'keyword'],
		['foo(1);', 'foo', 'function'],
		['obj.method(1);', 'method', 'function'],
		['ns::fn<int>(1);', 'ns', 'identifier'],
		['x = MAX_SIZE;', 'MAX_SIZE', 'constant'],
		['char8_t c;', 'char8_t', 'type'],
		['int intx;', 'intx', 'identifier'],
		['int café = 1;', 'café', 'identifier'],
		['_Static_assert(sizeof(_Bool) == 1);', '_Static_assert', 'keyword'],
		['_Static_assert(sizeof(_Bool) == 1);', '_Bool', 'type'],
		['if (a and not b) {}', 'and', 'operator'],
		['int android;', 'android', 'identifier'],
		// operators
		['auto c = a <=> b;', '<=>', 'operator'],
		['p->*m;', '->*', 'operator'],
		['std::vector<int> v;', '::', 'operator'],
		['[[nodiscard]] int f();', '[[', 'punctuation']
	])('%j: %j is %s', (src, piece, type) => {
		const types = typesOf(src, piece);
		expect(types.length).toBeGreaterThan(0);
		expect(new Set(types)).toEqual(new Set([type]));
		// a number is one token, so the word diff compares it whole
		if (type === 'number') expect(types).toHaveLength(1);
	});

	it('emits ordered, non-overlapping tokens inside the input', () => {
		const src = [
			'#include <map>',
			'template <typename T> struct Box { T v; };',
			'auto r = R"x(a)b)x"; auto s = "unterminated',
			"int n = 1'0 + 0x1p-3; // done",
			'/* open comment'
		].join('\n');
		let last = 0;
		for (const [start, end] of tokenRanges('cpp', src)) {
			expect(start).toBeGreaterThanOrEqual(last);
			expect(end).toBeGreaterThan(start);
			last = end;
		}
		expect(last).toBeLessThanOrEqual(src.length);
	});
});
