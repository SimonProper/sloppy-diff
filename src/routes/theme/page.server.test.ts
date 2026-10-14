import { expect, test } from 'vitest';
import { load } from './+page.server';

test('the sample change parses whole and comes highlighted, with its changed tokens marked', () => {
	const { file } = load();
	const [hunk] = file.hunks;
	expect(file.hunks).toHaveLength(1);
	expect(hunk.lines.filter((l) => l.kind !== 'add')).toHaveLength(hunk.oldLines);
	expect(hunk.lines.filter((l) => l.kind !== 'del')).toHaveLength(hunk.newLines);
	expect(hunk.lines.every((l) => !l.text || l.html)).toBe(true);
	expect(hunk.lines.some((l) => l.html?.includes('keyword'))).toBe(true);
	expect(hunk.lines.some((l) => l.spans?.length)).toBe(true);
});
