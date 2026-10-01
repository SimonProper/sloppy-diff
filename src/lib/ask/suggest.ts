import MarkdownIt from 'markdown-it';
import type { Suggestion } from './types';

/** A suggestion's fenced block and where it sits in the answer, `end` past its closing fence. */
export interface SuggestionBlock {
	suggestion: Suggestion;
	start: number;
	end: number;
}

const ATTRIBUTE = /(\w+)=(?:"([^"]*)"|(\S+))/g;
const LINES = /^(\d+)(?:-(\d+))?$/;
// only to find the fences, the way the answer is rendered finds them
const parser = new MarkdownIt();

/** The suggestions in an answer's markdown. A malformed block isn't one, it stays a code block. */
export const parseSuggestions = (markdown: string): Suggestion[] =>
	suggestionBlocks(markdown).map((b) => b.suggestion);

/**
 * The answer's top-level fenced blocks that are suggestions. Found by markdown-it, so an
 * example inside another code block stays in it, and a comment quoting code in a fence of
 * its own ends where the rendered block does.
 */
export function suggestionBlocks(markdown: string): SuggestionBlock[] {
	const lines = markdown.split('\n');
	const offsets = [0];
	for (const line of lines) offsets.push(offsets.at(-1)! + line.length + 1);
	const blocks: SuggestionBlock[] = [];
	for (const token of parser.parse(markdown, {})) {
		if (token.type !== 'fence' || !token.map || !token.markup.startsWith('`')) continue;
		const [kind, ...rest] = token.info.trim().split(/\s+/);
		if (kind !== 'review' && kind !== 'reply') continue;
		const [first, end] = token.map;
		// one never closed runs to the end of the answer, it's left as the code block it shows as
		const closing = lines[end - 1]?.trim() ?? '';
		if (end - first < 2 || !closing.startsWith(token.markup) || /[^`]/.test(closing)) continue;
		const info = rest.join(' ');
		// anything left over is a malformed attribute, `line=12 - 14` isn't line 12
		if (info.replace(ATTRIBUTE, '').trim()) continue;
		const attributes = new Map(
			[...info.matchAll(ATTRIBUTE)].map(([, key, quoted, plain]) => [key, quoted ?? plain])
		);
		const suggestion = toSuggestion(kind, attributes, token.content.trim());
		if (!suggestion) continue;
		blocks.push({
			suggestion,
			start: offsets[first],
			end: Math.min(offsets[end], markdown.length)
		});
	}
	return blocks;
}

function toSuggestion(kind: string, attributes: Map<string, string>, body: string) {
	if (!body) return null;
	if (kind === 'reply') {
		const thread = attributes.get('thread');
		return thread ? ({ kind: 'reply', thread, body } satisfies Suggestion) : null;
	}
	const path = attributes.get('path');
	const side = attributes.get('side') ?? 'new';
	if (!path || (side !== 'new' && side !== 'old')) return null;
	const suggestion: Suggestion = { kind: 'review', path, side, body };
	const lines = attributes.get('line');
	if (lines === undefined) return suggestion;
	const [, first, last] = LINES.exec(lines) ?? [];
	const start = Number(first);
	const end = Number(last ?? first);
	if (!first || start < 1 || end < start) return null;
	suggestion.line = end;
	if (end !== start) suggestion.startLine = start;
	return suggestion;
}
