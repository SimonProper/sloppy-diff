import type { Suggestion } from './types';

/** A suggestion's fenced block and where it sits in the answer, `end` past its closing fence. */
export interface SuggestionBlock {
	suggestion: Suggestion;
	start: number;
	end: number;
}

// a fence closes on a line of at least as many backticks as opened it, so a comment
// can quote code inside a longer fence
const FENCE = /^(`{3,})(review|reply)[ \t]+(.*)\n([^]*?)\n?^\1`*[ \t]*$\n?/gm;
const ATTRIBUTE = /(\w+)=(?:"([^"]*)"|(\S+))/g;
const LINES = /^(\d+)(?:-(\d+))?$/;

/** The suggestions in an answer's markdown. A malformed block isn't one, it stays a code block. */
export const parseSuggestions = (markdown: string): Suggestion[] =>
	suggestionBlocks(markdown).map((b) => b.suggestion);

export function suggestionBlocks(markdown: string): SuggestionBlock[] {
	const blocks: SuggestionBlock[] = [];
	for (const match of markdown.matchAll(FENCE)) {
		const [whole, , kind, info, text] = match;
		const attributes = new Map(
			[...info.matchAll(ATTRIBUTE)].map(([, key, quoted, plain]) => [key, quoted ?? plain])
		);
		const suggestion = toSuggestion(kind, attributes, text.trim());
		if (!suggestion) continue;
		blocks.push({ suggestion, start: match.index, end: match.index + whole.length });
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
