import { expect, test } from 'vitest';
import type { Thread } from '$lib/ask/types';
import { parseDiff } from '$lib/diff/parse';
import { renderThread } from './threads';

// new: 1 a, 2 B, 3 c
const files = parseDiff(
	'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'
);

test('suggestions become cards, checked against the diff', () => {
	const text = [
		'Some notes.',
		'```review path=f.ts line=2',
		'Rename **B**.',
		'```',
		'```review path=f.ts line=40',
		'Not in the diff.',
		'```',
		'```review path=gone.ts line=1',
		'Another file.',
		'```'
	].join('\n');
	const thread: Thread = {
		id: 'abcdefabcdef',
		anchor: { path: '', label: 'whole change', code: '' },
		createdAt: '',
		messages: [{ role: 'assistant', text, createdAt: '' }]
	};
	const [message] = renderThread(thread, files).messages;

	expect(message.suggestions).toEqual([
		{
			kind: 'review',
			path: 'f.ts',
			side: 'new',
			line: 2,
			body: 'Rename **B**.',
			span: { hunk: files[0].hunks[0].id, start: 2, end: 2, side: 'new' },
			html: '<p>Rename <strong>B</strong>.</p>\n'
		},
		// lines outside the diff: about the whole file instead
		{
			kind: 'review',
			path: 'f.ts',
			side: 'new',
			body: 'Not in the diff.',
			html: '<p>Not in the diff.</p>\n'
		}
	]);
	// a file outside the diff stays in the answer as written
	expect(message.html).toContain('Some notes.');
	expect(message.html).toContain('Another file.');
	expect(message.html).not.toContain('Rename');
	expect(message.html).not.toContain('Not in the diff');
});
