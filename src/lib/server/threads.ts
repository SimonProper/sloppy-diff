import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { linesOf, type Anchor, type LineSpan, type Scope, type Thread } from '$lib/ask/types';
import { spanLabel, spanLines } from '$lib/ask/span';
import { findHunk } from '$lib/diff/hunks';
import type { DiffFile, DiffLine, Hunk } from '$lib/diff/types';
import { repoDir } from './guides';
import { markdown } from './markdown';

/**
 * Questions asked about a diff, saved next to the guides: one file per commit
 * range, and one for the uncommitted changes. Threads are anchored to hunk
 * ids, which hash the content, so they stay put while the code does.
 */

const SCOPE = /^(worktree|[0-9a-f]{4,64}\.\.[0-9a-f]{4,64})$/;
const THREAD_ID = /^[0-9a-f]{12}$/;

export function checkScope(scope: string): Scope {
	if (!SCOPE.test(scope)) throw new Error(`Invalid scope: ${scope}`);
	return scope as Scope;
}

export function checkThreadId(id: string): string {
	if (!THREAD_ID.test(id)) throw new Error(`Invalid thread: ${id}`);
	return id;
}

export const newThreadId = () => randomBytes(6).toString('hex');

function threadsPath(root: string, scope: Scope): string {
	return join(repoDir(root), 'threads', `${checkScope(scope)}.json`);
}

export async function loadThreads(root: string, scope: Scope): Promise<Thread[]> {
	try {
		return JSON.parse(await readFile(threadsPath(root, scope), 'utf8')).threads ?? [];
	} catch {
		return [];
	}
}

// one change at a time per file, two answers finishing together would otherwise
// each write the file without the other's thread
const queues = new Map<string, Promise<unknown>>();

/**
 * Applies `change` to the saved threads and writes them back, returns the
 * threads. Returning the same array leaves the file alone.
 */
export function updateThreads(
	root: string,
	scope: Scope,
	change: (threads: Thread[]) => Thread[]
): Promise<Thread[]> {
	const path = threadsPath(root, scope);
	const next = (queues.get(path) ?? Promise.resolve()).then(async () => {
		const current = await loadThreads(root, scope);
		const threads = change(current);
		if (threads === current) return current;
		await mkdir(dirname(path), { recursive: true });
		// written aside first, a crash mid-write must not lose every thread
		const temp = `${path}.${process.pid}.tmp`;
		await writeFile(temp, JSON.stringify({ version: 1, threads }, null, '\t'));
		await rename(temp, path);
		return threads;
	});
	queues.set(
		path,
		next.catch(() => {})
	);
	return next;
}

/** Saves a thread, replacing the one with its id. */
export function saveThread(root: string, scope: Scope, thread: Thread) {
	return updateThreads(root, scope, (threads) =>
		threads.some((t) => t.id === thread.id)
			? threads.map((t) => (t.id === thread.id ? thread : t))
			: [...threads, thread]
	);
}

export async function deleteThread(root: string, scope: Scope, id: string) {
	checkThreadId(id);
	const left = await updateThreads(root, scope, (threads) => threads.filter((t) => t.id !== id));
	if (left.length === 0) await rm(threadsPath(root, scope), { force: true });
}

/** The file and hunk with this id, if the diff still has it. */
const marker = (line: DiffLine) => (line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ');

/** A hunk as prompt text, its header then up to `maxLines` marked lines. */
export function hunkText(hunk: Hunk, maxLines = Infinity): string {
	const body = hunk.lines.slice(0, maxLines).map((l) => marker(l) + l.text);
	if (hunk.lines.length > maxLines) {
		body.push(`… ${hunk.lines.length - maxLines} more lines, read the file to see them`);
	}
	return `${hunk.header}\n${body.join('\n')}`;
}

/** Checks a span against the diff and describes it, or throws when it doesn't fit. */
export function anchorFor(files: DiffFile[], span: LineSpan): Anchor {
	const found = findHunk(files, span.hunk);
	if (!found) throw new Error('Those lines are not in the diff anymore, reload the page');
	const { file, hunk } = found;
	const valid =
		Number.isInteger(span.start) &&
		Number.isInteger(span.end) &&
		span.start >= 0 &&
		span.start <= span.end &&
		span.end < hunk.lines.length &&
		(span.side === undefined || span.side === 'old' || span.side === 'new');
	const lines = valid ? spanLines(hunk, span) : [];
	if (lines.length === 0) throw new Error('Select some lines of the diff to ask about');

	return {
		hunk: span.hunk,
		start: span.start,
		end: span.end,
		...(span.side && { side: span.side }),
		path: file.newPath,
		label: spanLabel(hunk, span),
		code: lines.map((l) => marker(l) + l.text).join('\n')
	};
}

/** A question about a whole file of the diff, or with no path about the whole change. */
export function wholeAnchor(files: DiffFile[], path?: string): Anchor {
	if (!path) return { path: '', label: 'whole change', code: '' };
	if (!files.some((f) => f.newPath === path)) {
		throw new Error('That file is not in the diff anymore, reload the page');
	}
	return { path, label: 'whole file', code: '' };
}

/** Renders a thread's answers. */
export function renderThread(thread: Thread): Thread {
	return {
		...thread,
		messages: thread.messages.map((m) =>
			m.role === 'assistant' && m.text ? { ...m, html: markdown.render(m.text) } : m
		)
	};
}

/** Saved threads checked against the diff on screen, with their answers rendered. */
export function prepareThreads(threads: Thread[], files: DiffFile[]): Thread[] {
	return threads.map((thread) => {
		const { anchor } = thread;
		const lines = linesOf(anchor);
		const found = lines && findHunk(files, lines.hunk);
		// a file is outdated once it's out of the diff, the whole change never is
		const outdated = lines
			? !found || lines.end >= found.hunk.lines.length
			: anchor.path !== '' && !files.some((f) => f.newPath === anchor.path);
		return { ...renderThread(thread), outdated };
	});
}
