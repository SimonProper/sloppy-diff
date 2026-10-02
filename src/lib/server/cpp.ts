/**
 * C and C++ for twinkleplop, which has no grammar for them yet. Built the way
 * its published language packages are (see @twinkleplop/go): a lexer grammar
 * plus a couple of reclassifiers. Swap for @twinkleplop/cpp once it exists.
 */
import {
	ALNUM,
	DIGIT,
	LETTER,
	create_language,
	enter,
	fallback,
	goto,
	keyword,
	leave,
	match,
	on,
	promote_by_upper_snake_case,
	promote_function_calls,
	range,
	tag,
	to_html,
	type RenderOptions
} from '@twinkleplop/core';
import { compile, define_grammar } from '@twinkleplop/core/compile';
import * as T from '@twinkleplop/core/tokens';

const KEYWORDS = [
	'alignas',
	'alignof',
	'asm',
	'auto',
	'break',
	'case',
	'catch',
	'class',
	'co_await',
	'co_return',
	'co_yield',
	'concept',
	'const',
	'const_cast',
	'consteval',
	'constexpr',
	'constinit',
	'continue',
	'decltype',
	'default',
	'delete',
	'do',
	'dynamic_cast',
	'else',
	'enum',
	'explicit',
	'export',
	'extern',
	'final',
	'for',
	'friend',
	'goto',
	'if',
	'import',
	'inline',
	'module',
	'mutable',
	'namespace',
	'new',
	'noexcept',
	'nullptr',
	'operator',
	'override',
	'private',
	'protected',
	'public',
	'register',
	'reinterpret_cast',
	'requires',
	'restrict',
	'return',
	'sizeof',
	'static',
	'static_assert',
	'static_cast',
	'struct',
	'switch',
	'template',
	'this',
	'thread_local',
	'throw',
	'try',
	'typedef',
	'typeid',
	'typename',
	'union',
	'using',
	'virtual',
	'volatile',
	'while',
	// C11 and C23
	'_Alignas',
	'_Alignof',
	'_Atomic',
	'_Generic',
	'_Noreturn',
	'_Static_assert',
	'_Thread_local',
	'typeof'
];

const ALTERNATIVE_OPERATORS = [
	'and',
	'and_eq',
	'bitand',
	'bitor',
	'compl',
	'not',
	'not_eq',
	'or',
	'or_eq',
	'xor',
	'xor_eq'
];

const TYPES = [
	'_Bool',
	'bool',
	'char',
	'char8_t',
	'char16_t',
	'char32_t',
	'double',
	'float',
	'int',
	'long',
	'short',
	'signed',
	'unsigned',
	'void',
	'wchar_t',
	'size_t',
	'ssize_t',
	'ptrdiff_t',
	'int8_t',
	'int16_t',
	'int32_t',
	'int64_t',
	'uint8_t',
	'uint16_t',
	'uint32_t',
	'uint64_t',
	'intptr_t',
	'uintptr_t'
];

// longest first, so `<<=` wins over `<<` and `<`
const OPERATORS =
	'<=>,->*,<<=,>>=,...,->,.*,::,<<,>>,++,--,&&,||,==,!=,<=,>=,+=,-=,*=,/=,%=,&=,|=,^=,+,-,*,/,%,&,|,^,~,!,=,<,>,?'.split(
		','
	);

const ENCODINGS = ['u8', 'u', 'U', 'L', ''];
const OCTAL = range([['0', '7']]);
/** What can't be in a raw string's delimiter (and `"`, which ends it). */
const NOT_DELIMITER = ['"', ' ', '\t', '\n', '\r', '(', '\\'];
/** Identifiers may hold any non-ASCII character. */
const NON_ASCII = range([[0x80, 0x10ffff]]);

/** A quoted body ending at `quote`, with backslash escapes. Unterminated ones stop at the line's end. */
function quoted(quote: string) {
	return {
		rules: [
			match('\\', T.string_escape, enter('escape')),
			match(quote, T.string, leave()),
			on('\n', leave()),
			fallback({ token: T.string })
		]
	};
}

const grammar = define_grammar({
	name: 'cpp',
	states: {
		main: {
			rules: [
				on([' ', '\t', '\n', '\r']),
				match('//', T.comment, enter('line_comment')),
				match('/*', T.comment, enter('block_comment')),
				match('#', T.directive, enter('directive')),
				match(
					ENCODINGS.map((e) => e + 'R"('),
					T.string,
					enter('raw_string')
				),
				match(
					ENCODINGS.map((e) => e + 'R"'),
					T.string,
					enter('raw_delimited')
				),
				match(
					ENCODINGS.map((e) => e + '"'),
					T.string,
					enter('string')
				),
				match(
					ENCODINGS.map((e) => e + "'"),
					T.string,
					enter('char')
				),
				match(
					['.0', '.1', '.2', '.3', '.4', '.5', '.6', '.7', '.8', '.9'],
					T.number,
					enter('number')
				),
				match(DIGIT, T.number, enter('number')),
				match(OPERATORS, T.operator),
				match(['(', ')', '[', ']', '{', '}', ',', ';', ':', '.'], T.punctuation),
				keyword(KEYWORDS),
				keyword(['true', 'false'], {}, T.boolean),
				keyword(ALTERNATIVE_OPERATORS, {}, T.operator),
				keyword(['defined', '__has_include'], {}, T.directive),
				keyword(TYPES, {}, T.type),
				match(['_', LETTER, NON_ASCII], T.identifier, enter('identifier'))
			]
		},
		identifier: { rules: [match(['_', ALNUM, NON_ASCII], T.identifier), fallback(leave())] },
		line_comment: {
			rules: [
				match(['\\\n', '\\\r\n'], T.comment),
				match('\n', T.comment, leave()),
				fallback({ token: T.comment })
			]
		},
		block_comment: { rules: [match('*/', T.comment, leave()), fallback({ token: T.comment })] },

		// `#` then the directive's name; the rest of the line reads as code
		directive: {
			rules: [
				on([' ', '\t']),
				match(['include', 'include_next', 'import'], T.directive, {
					...goto('include'),
					boundary: true
				}),
				match(LETTER, T.directive, goto('directive_name')),
				fallback(leave())
			]
		},
		directive_name: { rules: [match(['_', ALNUM], T.directive), fallback(leave())] },
		include: {
			rules: [
				on([' ', '\t']),
				match('<', T.string, goto('header')),
				match('"', T.string, goto('string')),
				fallback(leave())
			]
		},
		header: {
			rules: [match('>', T.string, leave()), on('\n', leave()), fallback({ token: T.string })]
		},

		string: quoted('"'),
		char: quoted("'"),
		escape: {
			rules: [
				match(['x', 'u', 'U'], T.string_escape, goto('escape_hex')),
				match(OCTAL, T.string_escape, goto('escape_octal')),
				match('\r\n', T.string_escape, leave()),
				fallback({ token: T.string_escape, exit: true })
			]
		},
		escape_hex: {
			rules: [
				match(
					range([
						['0', '9'],
						['a', 'f'],
						['A', 'F']
					]),
					T.string_escape
				),
				fallback(leave())
			]
		},
		// up to three octal digits, the first already read
		escape_octal: {
			rules: [match(OCTAL, T.string_escape, goto('escape_octal_last')), fallback(leave())]
		},
		escape_octal_last: { rules: [match(OCTAL, T.string_escape, leave()), fallback(leave())] },

		raw_string: { rules: [match(')"', T.string, leave()), fallback({ token: T.string })] },
		// ponytail: `R"x(` ends at the first `)delim"`, whatever the delimiter;
		// grammars can't capture the opening one to match it. Ends early only when
		// the body holds `)` + a different delimiter + `"`.
		raw_delimited: {
			rules: [match(')', T.string, goto('raw_close')), fallback({ token: T.string })]
		},
		raw_close: {
			rules: [
				match(')', T.string),
				match(NOT_DELIMITER, T.string, goto('raw_delimited')),
				fallback({ token: T.string, ...goto('raw_delimiter') })
			]
		},
		raw_delimiter: {
			rules: [
				match('"', T.string, leave()),
				match(')', T.string, goto('raw_close')),
				match(NOT_DELIMITER, T.string, goto('raw_delimited')),
				fallback({ token: T.string })
			]
		},

		// a pp-number: digits, letters, `.`, `'` separators and exponents
		number: {
			rules: [
				match(['e', 'E', 'p', 'P'], T.number, goto('exponent')),
				match(['_', "'", '.', ALNUM], T.number),
				fallback(leave())
			]
		},
		exponent: { rules: [match(['+', '-'], T.number, goto('number')), fallback(goto('number'))] }
	}
});

export const tokenize = create_language(compile(grammar), [
	tag(promote_function_calls('identifier', 'function'), ['function']),
	tag(promote_by_upper_snake_case('identifier', 'constant'), ['constant'])
]);

export function language() {
	const tokens = tokenize();
	return (input: string, options?: RenderOptions) => to_html(input, tokens(input), options);
}

export { grammar as raw_grammar };
