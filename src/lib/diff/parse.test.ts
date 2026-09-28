import { describe, expect, test } from 'vitest';
import { parseDiff } from './parse';

describe('file headers', () => {
	test('a renamed file without changes', () => {
		const [file] = parseDiff(
			'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n'
		);
		expect(file).toMatchObject({ status: 'renamed', oldPath: 'old.ts', newPath: 'new.ts' });
	});

	test('a binary file whose path contains " b/"', () => {
		const [file] = parseDiff(
			'diff --git a/dir b/img.bin b/dir b/img.bin\nindex 1..2 100644\nBinary files a/dir b/img.bin and b/dir b/img.bin differ\n'
		);
		expect(file).toMatchObject({
			binary: true,
			oldPath: 'dir b/img.bin',
			newPath: 'dir b/img.bin'
		});
	});

	test('quoted paths with escapes and octal bytes', () => {
		const [accent, quote] = parseDiff(
			[
				'diff --git "a/quo\\"te.bin" "b/quo\\"te.bin"',
				'Binary files differ',
				'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
				'old mode 100644',
				'new mode 100755',
				''
			].join('\n')
		);
		expect(quote.newPath).toBe('quo"te.bin');
		expect(accent.newPath).toBe('café.txt');
	});

	test('a deleted file and a new empty file', () => {
		const [added, deleted] = parseDiff(
			[
				'diff --git a/gone.ts b/gone.ts',
				'deleted file mode 100644',
				'--- a/gone.ts',
				'+++ /dev/null',
				'@@ -1 +0,0 @@',
				'-bye',
				'diff --git a/empty.txt b/empty.txt',
				'new file mode 100644',
				''
			].join('\n')
		);
		expect(deleted).toMatchObject({
			status: 'deleted',
			oldPath: 'gone.ts',
			newPath: 'gone.ts',
			deletions: 1
		});
		expect(added).toMatchObject({ status: 'added', newPath: 'empty.txt', hunks: [] });
	});

	test('files come in folder tree order, numbered in it', () => {
		const files = parseDiff(
			['src/app.ts', 'src/lib/b.ts', 'README.md', 'src/lib/a.ts']
				.map((path) => `diff --git a/${path} b/${path}\nBinary files differ\n`)
				.join('')
		);
		expect(files.map((f) => [f.id, f.newPath])).toEqual([
			['file-0', 'src/lib/a.ts'],
			['file-1', 'src/lib/b.ts'],
			['file-2', 'src/app.ts'],
			['file-3', 'README.md']
		]);
	});
});

describe('hunks', () => {
	test('a removed line that looks like a file header stays in the hunk', () => {
		const [file] = parseDiff(
			['--- a/f.md', '+++ b/f.md', '@@ -1,2 +1 @@', '--- a/not-a-header', ' kept', ''].join('\n')
		);
		expect(file.hunks[0].lines.map((l) => [l.kind, l.text])).toEqual([
			['del', '-- a/not-a-header'],
			['ctx', 'kept']
		]);
	});

	test('no newline at end of file, and headers without counts', () => {
		const [file] = parseDiff(
			['--- a/f', '+++ b/f', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b', ''].join(
				'\n'
			)
		);
		expect(file.hunks[0].lines.map((l) => [l.kind, l.noNewline ?? false])).toEqual([
			['del', true],
			['add', false]
		]);
	});

	test('hunk ids stay the same when the hunk shifts, and repeats get a suffix', () => {
		const patch = (start: number) =>
			[
				'--- a/f',
				'+++ b/f',
				`@@ -${start},1 +${start},1 @@`,
				'-x',
				'+y',
				`@@ -${start + 10},1 +${start + 10},1 @@`,
				'-x',
				'+y',
				''
			].join('\n');
		const [a] = parseDiff(patch(1));
		const [b] = parseDiff(patch(40));
		expect(a.hunks.map((h) => h.id)).toEqual(b.hunks.map((h) => h.id));
		expect(a.hunks[1].id).toBe(`${a.hunks[0].id}-2`);
	});
});
