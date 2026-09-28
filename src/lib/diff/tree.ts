import { displayPath } from './path';
import type { DiffFile } from './types';

export interface TreeDir {
	kind: 'dir';
	/** one or more folders, `src/lib` when src holds nothing but lib */
	name: string;
	/** full path, unique within the tree */
	path: string;
	children: TreeNode[];
	additions: number;
	deletions: number;
}

export interface TreeFile {
	kind: 'file';
	name: string;
	file: DiffFile;
}

export type TreeNode = TreeDir | TreeFile;

/**
 * The files as a folder tree: folders first, then files, each alphabetical.
 * A folder holding a single folder and nothing else is merged into it, so
 * deep paths don't cost a level of indentation per segment.
 */
export function fileTree(files: DiffFile[]): TreeNode[] {
	const root: TreeDir = {
		kind: 'dir',
		name: '',
		path: '',
		children: [],
		additions: 0,
		deletions: 0
	};

	for (const file of files) {
		const segments = displayPath(file).split('/');
		const name = segments.pop()!;
		let dir = root;
		for (const segment of segments) {
			const path = dir.path ? `${dir.path}/${segment}` : segment;
			let next = dir.children.find((c): c is TreeDir => c.kind === 'dir' && c.name === segment);
			if (!next) {
				next = { kind: 'dir', name: segment, path, children: [], additions: 0, deletions: 0 };
				dir.children.push(next);
			}
			dir = next;
		}
		dir.children.push({ kind: 'file', name, file });
	}

	return finish(root).children;
}

/** The files in the order the tree shows them, so a flat list reads the same. */
export function treeOrder(files: DiffFile[]): DiffFile[] {
	const walk = (nodes: TreeNode[]): DiffFile[] =>
		nodes.flatMap((n) => (n.kind === 'dir' ? walk(n.children) : [n.file]));
	return walk(fileTree(files));
}

/** Merges single-folder chains, adds up the counts and sorts, depth first. */
function finish(dir: TreeDir): TreeDir {
	dir.children = dir.children.map((c) => (c.kind === 'dir' ? finish(c) : c));
	for (const child of dir.children) {
		const counts = child.kind === 'dir' ? child : child.file;
		dir.additions += counts.additions;
		dir.deletions += counts.deletions;
	}
	dir.children.sort(
		(a, b) =>
			Number(b.kind === 'dir') - Number(a.kind === 'dir') ||
			a.name.localeCompare(b.name, undefined, { numeric: true })
	);
	const [only] = dir.children;
	if (dir.path && dir.children.length === 1 && only.kind === 'dir') {
		return { ...only, name: `${dir.name}/${only.name}` };
	}
	return dir;
}
