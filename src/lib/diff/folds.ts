/**
 * Files opened or closed by hand, so a reload or a diff that refreshes keeps them
 * the way the reader left them. Kept by path within a scope: the repo for the full
 * diff, a guide's step for the files it shows. Only choices that differ from how
 * the file starts are kept, the oldest dropped past a limit.
 */
import { readJson, writeJson } from '$lib/storage';

const KEY = 'file-folds';
const LIMIT = 1000;

/** open or not, by scope and path, oldest first */
let folds: Map<string, boolean> | null = null;

function load(): Map<string, boolean> {
	folds ??= new Map(readJson<[string, boolean][]>(KEY, []));
	return folds;
}

const id = (scope: string, path: string) => `${scope}\n${path}`;

/** Whether the reader left the file open, undefined when they never toggled it. */
export function storedOpen(scope: string, path: string): boolean | undefined {
	return load().get(id(scope, path));
}

export function storeOpen(scope: string, path: string, open: boolean, startsOpen: boolean) {
	const all = load();
	// re-added so it's the newest
	all.delete(id(scope, path));
	if (open !== startsOpen) all.set(id(scope, path), open);
	for (const key of all.keys()) {
		if (all.size <= LIMIT) break;
		all.delete(key);
	}
	writeJson(KEY, [...all]);
}
