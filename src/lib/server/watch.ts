import { watch, type FSWatcher } from 'node:fs';
import { run, whenFetched } from './sync';

/**
 * Something about a repo's worktrees changed, for whoever follows them: a session's state, a
 * fetch, git in one of them, a file. Told by the main checkout's path.
 */
type Listener = () => void;

// kept on globalThis so a dev server module reload keeps what's listening
const store = globalThis as { __repoListeners?: Map<string, Set<Listener>> };
const listeners = (store.__repoListeners ??= new Map<string, Set<Listener>>());

export function notify(main: string) {
	for (const listener of listeners.get(main) ?? []) listener();
}

whenFetched(notify);

export function listen(main: string, listener: Listener): () => void {
	let set = listeners.get(main);
	if (!set) listeners.set(main, (set = new Set()));
	set.add(listener);
	return () => set.delete(listener);
}

/** folders a change in is the build's or the packages', never the work */
const IGNORED = /(^|\/)(\.git|\.guides|node_modules|\.svelte-kit|build|dist|\.next|target)(\/|$)/;

/**
 * Watches the worktrees for changes and tells the repo's listeners: each one's git folder, where
 * a commit, a checkout, staging, a rebase or a merge shows, the folder they share, where a fetch
 * and new worktrees show, and the files, for an edit made anywhere. The files only where the
 * system watches a whole tree cheaply, macOS and Windows; on Linux Node would watch every folder
 * on its own, and an edit shows when it's staged or the window is back in focus.
 */
export class Watchers {
	#watching = new Map<string, FSWatcher[]>();
	#main: string;

	constructor(main: string) {
		this.#main = main;
	}

	/** Watches these worktrees, and stops watching the ones no longer among them. */
	async follow(paths: string[]) {
		for (const [path, watchers] of this.#watching) {
			if (paths.includes(path)) continue;
			for (const w of watchers) w.close();
			this.#watching.delete(path);
		}
		for (const path of paths) {
			if (this.#watching.has(path)) continue;
			this.#watching.set(path, []);
			const [gitDir, common] = await Promise.all([
				run(path, ['rev-parse', '--absolute-git-dir']).then(
					(p) => p.trim(),
					() => ''
				),
				run(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']).then(
					(p) => p.trim(),
					() => ''
				)
			]);
			// stopped meanwhile
			const watchers = this.#watching.get(path);
			if (!watchers) continue;
			const tell = () => notify(this.#main);
			const add = (dir: string, recursive: boolean, keep?: (file: string) => boolean) => {
				try {
					const watcher = watch(dir, { recursive }, (_, file) => {
						if (!keep || (file && keep(file.toString()))) tell();
					});
					watcher.on('error', () => watcher.close());
					watchers.push(watcher);
				} catch {
					// gone, or more than the system will watch: focus still reads it again
				}
			};
			if (gitDir) add(gitDir, false);
			// a worktree's git folder is inside the shared one, the main checkout's is the shared one
			if (common && common !== gitDir) add(common, false);
			if (common) add(`${common}/refs`, process.platform !== 'linux');
			if (process.platform !== 'linux') add(path, true, (file) => !IGNORED.test(file));
		}
	}

	close() {
		for (const watchers of this.#watching.values()) for (const w of watchers) w.close();
		this.#watching.clear();
	}
}
