import { expect, test } from 'vitest';
import { parseSuggestions, suggestionBlocks } from './suggest';

test('parseSuggestions reads review and reply blocks', () => {
	const answer = [
		'Two things.',
		'```review path=src/a.ts line=12',
		'Name this `total`.',
		'```',
		'```review path=src/a.ts line=12-14',
		'Pull this out.',
		'```',
		'```review path=src/b.ts line=3 side=old',
		'Why was this removed?',
		'```',
		'```review path="docs/read me.md"',
		'Mention the flag.',
		'```',
		'```reply thread=PRRT_kwDOabc',
		'Agreed, **fixed** below.',
		'```'
	].join('\n');
	expect(parseSuggestions(answer)).toEqual([
		{ kind: 'review', path: 'src/a.ts', side: 'new', line: 12, body: 'Name this `total`.' },
		{
			kind: 'review',
			path: 'src/a.ts',
			side: 'new',
			line: 14,
			startLine: 12,
			body: 'Pull this out.'
		},
		{ kind: 'review', path: 'src/b.ts', side: 'old', line: 3, body: 'Why was this removed?' },
		{ kind: 'review', path: 'docs/read me.md', side: 'new', body: 'Mention the flag.' },
		{ kind: 'reply', thread: 'PRRT_kwDOabc', body: 'Agreed, **fixed** below.' }
	]);
});

test('a longer fence keeps the code a comment quotes', () => {
	const answer = '````review path=a.ts line=1\nTry:\n```ts\nx()\n```\n````\nAfter.';
	const [block] = suggestionBlocks(answer);
	expect(block.suggestion).toMatchObject({ body: 'Try:\n```ts\nx()\n```' });
	expect(answer.slice(0, block.start) + answer.slice(block.end)).toBe('After.');
});

test('malformed blocks are ignored, not thrown', () => {
	const answer = [
		'```review line=3\nno path\n```',
		'```review path=a.ts line=x\nbad line\n```',
		'```review path=a.ts line=5-2\nbackwards\n```',
		'```review path=a.ts side=left\nbad side\n```',
		'```reply\nno thread\n```',
		'```review path=a.ts\n```',
		'```ts\nplain code\n```',
		'```review path=a.ts line=1\nnever closed'
	].join('\n');
	expect(parseSuggestions(answer)).toEqual([]);
});
