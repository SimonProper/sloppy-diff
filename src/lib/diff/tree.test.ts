import { expect, test } from 'vitest';
import { fileTree, type TreeNode } from './tree';
import type { DiffFile } from './types';

function file(path: string, additions = 1, deletions = 0, status = 'modified'): DiffFile {
	return {
		id: path,
		oldPath: path,
		newPath: status === 'deleted' ? '/dev/null' : path,
		status,
		additions,
		deletions,
		binary: false,
		hunks: []
	} as unknown as DiffFile;
}

/** A readable outline: folders end in /, children indented under them. */
function outline(nodes: TreeNode[], depth = 0): string[] {
	return nodes.flatMap((n) =>
		n.kind === 'dir'
			? [
					`${'  '.repeat(depth)}${n.name}/ +${n.additions} -${n.deletions}`,
					...outline(n.children, depth + 1)
				]
			: [`${'  '.repeat(depth)}${n.name}`]
	);
}

test('folders come first, single-folder chains merge, counts add up', () => {
	const tree = fileTree([
		file('README.md'),
		file('src/lib/components/FileList.svelte', 3, 1),
		file('src/lib/components/FileDiff.svelte', 2),
		file('src/lib/diff/tree.ts', 5),
		file('src/app.html', 1, 2)
	]);
	expect(outline(tree)).toEqual([
		'src/ +11 -3',
		'  lib/ +10 -1',
		'    components/ +5 -1',
		'      FileDiff.svelte',
		'      FileList.svelte',
		'    diff/ +5 -0',
		'      tree.ts',
		'  app.html',
		'README.md'
	]);
});

test('a folder chain down to the files is one row', () => {
	expect(outline(fileTree([file('a/b/c/one.ts'), file('a/b/c/two.ts')]))).toEqual([
		'a/b/c/ +2 -0',
		'  one.ts',
		'  two.ts'
	]);
});

test('deleted files sit under their old path, names sort numerically', () => {
	const tree = fileTree([file('v10.ts'), file('v2.ts'), file('old/gone.ts', 0, 4, 'deleted')]);
	expect(outline(tree)).toEqual(['old/ +0 -4', '  gone.ts', 'v2.ts', 'v10.ts']);
});
