import * as bash from '@twinkleplop/bash';
import * as css from '@twinkleplop/css';
import * as go from '@twinkleplop/go';
import * as html from '@twinkleplop/html';
import * as javascript from '@twinkleplop/javascript';
import * as json from '@twinkleplop/json';
import * as markdown from '@twinkleplop/markdown';
import * as python from '@twinkleplop/python';
import * as rust from '@twinkleplop/rust';
import * as sql from '@twinkleplop/sql';
import * as svelte from '@twinkleplop/svelte';
import * as toml from '@twinkleplop/toml';
import * as tsx from '@twinkleplop/tsx';
import * as typescript from '@twinkleplop/typescript';
import * as yaml from '@twinkleplop/yaml';
import type { RenderOptions, TokenizeResult } from '@twinkleplop/core';
import type { DiffFile, DiffLine } from '$lib/diff/types';
import { markdown as md } from '$lib/server/markdown';

type Highlighter = (input: string, render?: RenderOptions) => string;
type Tokenizer = (input: string) => TokenizeResult;

const packages = {
	bash,
	css,
	go,
	html,
	javascript,
	json,
	markdown,
	python,
	rust,
	sql,
	svelte,
	toml,
	tsx,
	typescript,
	yaml
};
export type Language = keyof typeof packages;

const extensions: Record<string, Language> = {
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	css: 'css',
	scss: 'css',
	pcss: 'css',
	go: 'go',
	html: 'html',
	htm: 'html',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	json: 'json',
	jsonc: 'json',
	md: 'markdown',
	markdown: 'markdown',
	py: 'python',
	rs: 'rust',
	sql: 'sql',
	svelte: 'svelte',
	toml: 'toml',
	jsx: 'tsx',
	tsx: 'tsx',
	ts: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	yml: 'yaml',
	yaml: 'yaml'
};

const filenames: Record<string, Language> = {
	'.bashrc': 'bash',
	'.zshrc': 'bash',
	'.prettierrc': 'json'
};

// built on first use, per language and per kind
const grammars = new Map<Language, { highlight?: Highlighter; tokenize?: Tokenizer }>();

function grammar(lang: Language) {
	let g = grammars.get(lang);
	if (!g) grammars.set(lang, (g = {}));
	return g;
}

function highlighter(lang: Language): Highlighter {
	return (grammar(lang).highlight ??= packages[lang].language());
}

/** [start, end, type] of every token twinkleplop finds in `text`, in order. */
export function tokenRanges(lang: Language, text: string): [number, number, string][] {
	const fn = (grammar(lang).tokenize ??= packages[lang].tokenize());
	// tokens are flat triples of [type, start, end], the type an index into token_types
	const { tokens, token_types: types } = fn(text);
	const ranges: [number, number, string][] = [];
	for (let i = 0; i < tokens.length; i += 3) {
		ranges.push([tokens[i + 1], tokens[i + 2], types[tokens[i]] ?? '']);
	}
	return ranges;
}

export function detectLanguage(path: string): Language | null {
	const name = path.split('/').pop() ?? '';
	if (filenames[name]) return filenames[name];
	const dot = name.lastIndexOf('.');
	if (dot <= 0) return null;
	return extensions[name.slice(dot + 1).toLowerCase()] ?? null;
}

const LINE_OPEN = '<span class="l">';
const LINE_CLOSE = '</span>';

/**
 * Highlights a run of lines as one block and returns the markup per line.
 * twinkleplop closes and reopens token spans at every newline, so each
 * line of its output is self-contained and safe to render on its own.
 * Changed pieces become overlays, which wrap the tokens they touch in
 * `<span class="tok novel">` and keep the syntax colours underneath.
 */
function highlightLines(lines: DiffLine[], lang: Language): string[] | null {
	if (lines.length === 0) return [];
	const overlays: NonNullable<RenderOptions['overlays']> = [];
	let offset = 0;
	for (const line of lines) {
		for (const [start, end] of line.spans ?? []) {
			overlays.push({ start: offset + start, end: offset + end, class: 'novel' });
		}
		offset += line.text.length + 1;
	}
	try {
		const out = highlighter(lang)(
			lines.map((l) => l.text).join('\n'),
			overlays.length ? { overlays } : undefined
		);
		const code = out.slice(out.indexOf('<code>') + 6, out.lastIndexOf('</code>'));
		const rows = code.split('\n').map((row) => row.slice(LINE_OPEN.length, -LINE_CLOSE.length));
		return rows.length === lines.length ? rows : null;
	} catch {
		return null;
	}
}

/**
 * Fills in `html` for every line. The old side (context + deletions) and the
 * new side (context + additions) of each hunk are highlighted separately so
 * the tokenizer always sees code that actually existed at some point.
 */
export function highlightFile(file: DiffFile): DiffFile {
	const lang = detectLanguage(file.newPath);
	file.language = lang;

	for (const hunk of file.hunks) {
		const oldSide = hunk.lines.filter((l) => l.kind !== 'add');
		const newSide = hunk.lines.filter((l) => l.kind !== 'del');
		const oldHtml = lang ? highlightLines(oldSide, lang) : null;
		const newHtml = lang ? highlightLines(newSide, lang) : null;

		oldSide.forEach((line, i) => {
			if (line.kind === 'del') line.html = oldHtml?.[i] ?? plain(line);
		});
		newSide.forEach((line, i) => {
			line.html = newHtml?.[i] ?? plain(line);
		});
	}
	return file;
}

/** Escaped text for files without a grammar, changed pieces still marked. */
function plain(line: DiffLine): string {
	let out = '';
	let pos = 0;
	for (const [start, end] of line.spans ?? []) {
		out += md.utils.escapeHtml(line.text.slice(pos, start));
		out += `<span class="novel">${md.utils.escapeHtml(line.text.slice(start, end))}</span>`;
		pos = end;
	}
	return out + md.utils.escapeHtml(line.text.slice(pos));
}
