import type { DiffFile, Hunk } from './types';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Parses unified diff output (git or plain `diff -u`) into files and hunks. */
export function parseDiff(patch: string): DiffFile[] {
	const files: DiffFile[] = [];
	const lines = patch.split('\n');
	let file: DiffFile | null = null;
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (line.startsWith('diff --git ')) {
			const [oldPath, newPath] = gitHeaderPaths(line.slice(11));
			file = createFile(oldPath, newPath);
			files.push(file);
			i++;
			continue;
		}

		// plain unified diffs have no `diff --git` line, a new ---/+++ pair starts the next file
		const startsPlainFile = line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ');
		if (startsPlainFile && (!file || file.hunks.length > 0)) {
			file = createFile('', '');
			files.push(file);
		}

		if (!file) {
			i++;
			continue;
		}

		if (line.startsWith('@@')) {
			i = parseHunk(lines, i, file);
			continue;
		}

		if (line.startsWith('--- ')) {
			const path = headerPath(line.slice(4));
			if (path === null) file.status = 'added';
			else file.oldPath = path;
		} else if (line.startsWith('+++ ')) {
			const path = headerPath(line.slice(4));
			if (path === null) file.status = 'deleted';
			else file.newPath = path;
		} else if (line.startsWith('new file mode')) {
			file.status = 'added';
		} else if (line.startsWith('deleted file mode')) {
			file.status = 'deleted';
		} else if (line.startsWith('rename from ')) {
			file.status = 'renamed';
			file.oldPath = unquote(line.slice(12));
		} else if (line.startsWith('rename to ')) {
			file.newPath = unquote(line.slice(10));
		} else if (line.startsWith('copy from ')) {
			file.status = 'copied';
			file.oldPath = unquote(line.slice(10));
		} else if (line.startsWith('copy to ')) {
			file.newPath = unquote(line.slice(8));
		} else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
			file.binary = true;
		}
		i++;
	}

	files.forEach((f, index) => {
		if (!f.oldPath) f.oldPath = f.newPath;
		if (!f.newPath) f.newPath = f.oldPath;
		f.id = `file-${index}`;
		assignHunkIds(f);
	});
	return files;
}

/**
 * Hunk ids hash the path and the lines, not the line numbers, so a hunk keeps
 * its id when unrelated changes above it shift it up or down.
 */
function assignHunkIds(file: DiffFile) {
	const seen = new Set<string>();
	for (const hunk of file.hunks) {
		const content = hunk.lines.map((l) => l.kind[0] + l.text).join('\n');
		const base = 'h' + fnv1a(`${file.newPath}\n${content}`);
		let id = base;
		for (let n = 2; seen.has(id); n++) id = `${base}-${n}`;
		seen.add(id);
		hunk.id = id;
	}
}

function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36).padStart(7, '0');
}

function createFile(oldPath: string, newPath: string): DiffFile {
	return {
		id: '',
		oldPath,
		newPath,
		status: 'modified',
		binary: false,
		hunks: [],
		additions: 0,
		deletions: 0,
		language: null
	};
}

/** Consumes a hunk starting at `start`, returns the index of the first line after it. */
function parseHunk(lines: string[], start: number, file: DiffFile): number {
	const m = HUNK_RE.exec(lines[start]);
	if (!m) return start + 1;

	const hunk: Hunk = {
		id: '',
		header: lines[start],
		section: m[5] ?? '',
		oldStart: Number(m[1]),
		oldLines: m[2] === undefined ? 1 : Number(m[2]),
		newStart: Number(m[3]),
		newLines: m[4] === undefined ? 1 : Number(m[4]),
		lines: []
	};
	file.hunks.push(hunk);

	// the line counts in the header decide where the hunk ends, so content
	// such as "--- " on a deleted line is never mistaken for a file header
	let oldLeft = hunk.oldLines;
	let newLeft = hunk.newLines;
	let o = hunk.oldStart;
	let n = hunk.newStart;
	let i = start + 1;

	while (i < lines.length) {
		const line = lines[i];
		const marker = line[0];
		if (marker === '\\') {
			const last = hunk.lines.at(-1);
			if (last) last.noNewline = true;
		} else if (oldLeft <= 0 && newLeft <= 0) {
			break;
		} else if (marker === '+') {
			hunk.lines.push({ kind: 'add', text: line.slice(1), old: null, new: n++ });
			file.additions++;
			newLeft--;
		} else if (marker === '-') {
			hunk.lines.push({ kind: 'del', text: line.slice(1), old: o++, new: null });
			file.deletions++;
			oldLeft--;
		} else if (marker === ' ' || line === '') {
			// some tools strip the leading space of empty context lines
			hunk.lines.push({ kind: 'ctx', text: line.slice(1), old: o++, new: n++ });
			oldLeft--;
			newLeft--;
		} else {
			break;
		}
		i++;
	}
	return i;
}

/** Path from a ---/+++ header line, null for /dev/null. */
function headerPath(raw: string): string | null {
	// a quoted path can't hold a raw tab, git escapes it, so the first tab ends it
	const path = unquote(raw.startsWith('"') ? raw : raw.split('\t')[0]);
	if (path === '/dev/null') return null;
	return path.replace(/^[ab]\//, '');
}

/**
 * Both paths of `diff --git a/<old> b/<new>`. Most files also have ---/+++
 * lines, but binary, mode-only and empty files have only this one, and a
 * path may itself contain " b/". Unquoted and unrenamed, both halves are the
 * same path, which settles where it splits.
 */
function gitHeaderPaths(rest: string): [string, string] {
	const strip = (path: string) => path.replace(/^[ab]\//, '');
	if (rest.startsWith('"')) {
		const end = closingQuote(rest);
		const second = rest.slice(end + 2);
		return [strip(unquote(rest.slice(0, end + 1))), strip(unquote(second))];
	}
	if (rest.endsWith('"')) {
		const at = rest.lastIndexOf(' "');
		return [strip(rest.slice(0, at)), strip(unquote(rest.slice(at + 1)))];
	}
	const half = (rest.length - 5) / 2;
	const [a, b] = [rest.slice(2, 2 + half), rest.slice(5 + half)];
	if (
		Number.isInteger(half) &&
		rest.startsWith('a/') &&
		rest.slice(2 + half, 5 + half) === ' b/' &&
		a === b
	) {
		return [a, b];
	}
	// a rename, where the rename lines give the real paths anyway
	const at = rest.indexOf(' b/');
	return at < 0 ? [strip(rest), strip(rest)] : [strip(rest.slice(0, at)), rest.slice(at + 3)];
}

/** Index of the quote closing the quoted string `text` starts with. */
function closingQuote(text: string): number {
	for (let i = 1; i < text.length; i++) {
		if (text[i] === '\\') i++;
		else if (text[i] === '"') return i;
	}
	return text.length - 1;
}

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/**
 * Undoes git's C-style quoting of paths with unusual characters: backslash
 * escapes, and octal bytes for anything outside ASCII when core.quotePath is
 * on.
 */
function unquote(path: string): string {
	if (!path.startsWith('"') || !path.endsWith('"')) return path;
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	for (let i = 1; i < path.length - 1; i++) {
		const char = path[i];
		if (char !== '\\') {
			bytes.push(...encoder.encode(char));
			continue;
		}
		const next = path[++i];
		const octal = /^[0-7]{3}/.exec(path.slice(i, i + 3));
		if (octal) {
			bytes.push(parseInt(octal[0], 8));
			i += 2;
		} else {
			bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
		}
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}
