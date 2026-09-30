import { describe, expect, it } from 'vitest';
import { parseDiff } from '$lib/diff/parse';
import { highlightFile, openBlock } from './highlight';

const source = [
	'<script lang="ts">',
	'\tlet a = 1;',
	'\tlet b = 2;',
	'</script>',
	'',
	'<p>{a}</p>'
].join('\n');

describe('openBlock', () => {
	it('finds the tag a line sits inside', () => {
		expect(openBlock(source, 1)).toBe('');
		expect(openBlock(source, 3)).toBe('<script lang="ts">\n');
		expect(openBlock(source, 5)).toBe('');
		expect(openBlock(null, 3)).toBe('');
	});
});

describe('highlightFile', () => {
	it('highlights a svelte hunk that starts inside <script> as script', () => {
		const diff = [
			'diff --git a/A.svelte b/A.svelte',
			'--- a/A.svelte',
			'+++ b/A.svelte',
			'@@ -3,1 +3,1 @@',
			'-\tlet b = 3;',
			'+\tlet b = 2;',
			''
		].join('\n');
		const [file] = parseDiff(diff);
		highlightFile(file, { old: source.replace('= 2', '= 3'), new: source });
		for (const line of file.hunks[0].lines) {
			expect(line.html).toContain('<span class="tok keyword">let</span>');
		}
	});
});
