import { createHash } from 'node:crypto';
import { refState } from './git';

/**
 * Caches for the page load. Branch lists, commit lists and the default branch
 * only change when a ref does, so they're reused until then. Diffs between
 * two fixed commits never change at all.
 */

/**
 * Least recently used first out, once past `maxEntries` or past `maxWeight`
 * summed over the entries. The newest entry is always kept.
 */
function lru<V>(maxEntries: number, maxWeight = Infinity) {
	const entries = new Map<string, { value: V; weight: number }>();
	let total = 0;
	const forget = (key: string) => {
		const old = entries.get(key);
		if (!old) return;
		entries.delete(key);
		total -= old.weight;
	};
	return {
		get(key: string): V | undefined {
			const hit = entries.get(key);
			if (!hit) return undefined;
			// re-inserted on every use, so the oldest in the map is the least recently used
			entries.delete(key);
			entries.set(key, hit);
			return hit.value;
		},
		set(key: string, value: V, weight = 0) {
			forget(key);
			entries.set(key, { value, weight });
			total += weight;
			while (entries.size > 1 && (entries.size > maxEntries || total > maxWeight)) {
				forget(entries.keys().next().value!);
			}
		},
		delete: forget,
		clear() {
			entries.clear();
			total = 0;
		}
	};
}

/** Entries kept at most, each distinct url adds a few. */
const MEMO_LIMIT = 500;
const DIFF_LIMIT = 40;
/** Lines across all kept diffs, a few huge ones shouldn't hold the server's memory. */
const DIFF_LINES = 300_000;

const store = globalThis as {
	__memoLru?: ReturnType<typeof lru<{ version: string; value: Promise<unknown> }>>;
	__diffLru?: ReturnType<typeof lru<unknown>>;
};
// on globalThis so a dev server module reload keeps them
const memo = (store.__memoLru ??= lru(MEMO_LIMIT));
const diffs = (store.__diffLru ??= lru(DIFF_LIMIT, DIFF_LINES));

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

/** `compute` once per `version` of `key`, failures aren't kept. */
export function remember<T>(key: string, version: string, compute: () => Promise<T>): Promise<T> {
	const hit = memo.get(key);
	if (hit && hit.version === version) return hit.value as Promise<T>;
	const value = compute();
	memo.set(key, { version, value });
	value.catch(() => memo.delete(key));
	return value;
}

/** A finished diff between two fixed commits, most recently used kept. */
export function cachedDiff<T>(key: string): T | undefined {
	return diffs.get(key) as T | undefined;
}

/** Forgets every kept diff, for when the code that builds them changed. */
export function clearDiffs() {
	diffs.clear();
}

/** Keeps a diff, `weight` is its number of lines. */
export function storeDiff(key: string, value: unknown, weight: number) {
	diffs.set(key, value, weight);
}
