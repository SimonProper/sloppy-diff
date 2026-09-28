import { createHash } from 'node:crypto';
import { refState } from './git';

/**
 * Caches for the page load. Branch lists, commit lists and the default branch
 * only change when a ref does, so they're reused until then. Diffs between
 * two fixed commits never change at all.
 */

const store = globalThis as {
	__memo?: Map<string, { version: string; value: Promise<unknown> }>;
	__diffCache?: { entries: Map<string, { value: unknown; weight: number }>; lines: number };
};
// on globalThis so a dev server module reload keeps them
const memo = (store.__memo ??= new Map());
const diffs = (store.__diffCache ??= { entries: new Map(), lines: 0 });

/**
 * Changes whenever a branch, tag, remote or HEAD moves, however it happened:
 * nested branches, pushes, other worktrees and packed refs included. Asking
 * git costs a few milliseconds, watching its files misses too much.
 */
export async function repoVersion(root: string): Promise<string> {
	return createHash('sha1')
		.update(await refState(root))
		.digest('hex');
}

/** Entries kept at most, each distinct url adds a few. */
const MEMO_LIMIT = 500;

/** `compute` once per `version` of `key`, failures aren't kept. */
export function remember<T>(key: string, version: string, compute: () => Promise<T>): Promise<T> {
	const hit = memo.get(key);
	// re-inserted on every use, so the oldest in the map is the least recently used
	memo.delete(key);
	if (hit && hit.version === version) {
		memo.set(key, hit);
		return hit.value as Promise<T>;
	}
	const value = compute();
	memo.set(key, { version, value });
	value.catch(() => memo.delete(key));
	if (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value!);
	return value;
}

const DIFF_LIMIT = 40;
/** Lines across all kept diffs, a few huge ones shouldn't hold the server's memory. */
const DIFF_LINES = 300_000;

/** A finished diff between two fixed commits, most recently used kept. */
export function cachedDiff<T>(key: string): T | undefined {
	const hit = diffs.entries.get(key);
	if (!hit) return undefined;
	diffs.entries.delete(key);
	diffs.entries.set(key, hit);
	return hit.value as T;
}

/** Forgets every kept diff, for when the code that builds them changed. */
export function clearDiffs() {
	diffs.entries.clear();
	diffs.lines = 0;
}

/** Keeps a diff, `weight` is its number of lines. */
export function storeDiff(key: string, value: unknown, weight: number) {
	const { entries } = diffs;
	const old = entries.get(key);
	if (old) diffs.lines -= old.weight;
	entries.delete(key);
	entries.set(key, { value, weight });
	diffs.lines += weight;
	while (entries.size > 1 && (entries.size > DIFF_LIMIT || diffs.lines > DIFF_LINES)) {
		const [oldest, entry] = entries.entries().next().value!;
		entries.delete(oldest);
		diffs.lines -= entry.weight;
	}
}
