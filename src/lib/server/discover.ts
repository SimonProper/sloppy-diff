import { opendir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import { repoName, type FoundRepo, type Scan } from '$lib/repos';

/**
 * Finds git repositories on this machine by walking the home folder (or
 * REPO_ROOTS). Junk is kept out by construction rather than filtered later:
 *
 * - a folder with a `.git` is a repo and the walk stops there, so submodules,
 *   vendored clones and anything under node_modules never show up
 * - hidden folders (~/.cargo, ~/.cache, ~/.nvm, …) and known heavy or system
 *   folders are skipped
 * - symlinks aren't followed, depth and time are capped
 *
 * Only the file system is read, git itself never runs during a scan.
 */

const SKIP = new Set([
	'node_modules',
	'bower_components',
	'vendor',
	'target',
	'dist',
	'build',
	'out',
	'coverage',
	'venv',
	'__pycache__',
	'site-packages',
	'Pods',
	'DerivedData'
]);

// only skipped directly under the home folder, deeper folders with these names may be projects
const SKIP_IN_HOME = new Set([
	'Library',
	'Applications',
	'Movies',
	'Music',
	'Pictures',
	'Public',
	'go'
]);

const MAX_FOLDERS = 200_000;
const BUDGET_MS = 10_000;
const CONCURRENCY = 32;

function roots(): string[] {
	const configured = env.REPO_ROOTS?.split(':').filter(Boolean);
	return (configured?.length ? configured : [homedir()]).map((r) => resolve(r));
}

export async function scanRepos(): Promise<Scan> {
	const started = Date.now();
	const home = homedir();
	const depth = Number(env.REPO_SCAN_DEPTH) || 6;
	const found: string[] = [];
	let folders = 0;
	let truncated = false;

	let queue: { path: string; level: number }[] = roots().map((path) => ({ path, level: 0 }));
	while (queue.length) {
		if (Date.now() - started > BUDGET_MS || folders > MAX_FOLDERS) {
			truncated = true;
			break;
		}
		const batch = queue.splice(0, CONCURRENCY);
		const next = await Promise.all(
			batch.map(async ({ path, level }) => {
				folders++;
				const children: { path: string; level: number }[] = [];
				try {
					const dir = await opendir(path);
					let isRepo = false;
					for await (const entry of dir) {
						if (entry.name === '.git') {
							isRepo = true;
							continue;
						}
						if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
						if (SKIP.has(entry.name) || (path === home && SKIP_IN_HOME.has(entry.name))) continue;
						if (level + 1 <= depth)
							children.push({ path: join(path, entry.name), level: level + 1 });
					}
					if (isRepo) {
						found.push(path);
						return [];
					}
				} catch {
					// unreadable folders (permissions, races) are simply left out
				}
				return children;
			})
		);
		queue = queue.concat(next.flat());
	}

	const repos = await Promise.all(found.map(describe));
	repos.sort((a, b) => (b.active ?? '').localeCompare(a.active ?? ''));
	return {
		home,
		roots: roots(),
		repos,
		scannedAt: new Date().toISOString(),
		ms: Date.now() - started,
		folders,
		truncated
	};
}

/** Name, branch, last activity and remote, read straight from the .git folder. */
async function describe(path: string): Promise<FoundRepo> {
	let gitDir = join(path, '.git');
	// worktrees and submodule checkouts have a .git file pointing elsewhere
	const pointer = await readFile(gitDir, 'utf8').catch(() => null);
	const target = pointer?.match(/^gitdir: (.+)$/m)?.[1];
	if (target) gitDir = resolve(path, target.trim());

	const head = await readFile(join(gitDir, 'HEAD'), 'utf8').catch(() => '');
	const branch = head.match(/^ref: refs\/heads\/(.+)$/m)?.[1]?.trim() ?? null;

	const times = await Promise.all(
		['logs/HEAD', 'index', 'HEAD', 'FETCH_HEAD'].map((f) =>
			stat(join(gitDir, f)).then(
				(s) => s.mtimeMs,
				() => 0
			)
		)
	);
	const newest = Math.max(...times);

	const config = await readFile(join(gitDir, 'config'), 'utf8').catch(() => '');
	const origin = config.match(/\[remote "origin"\][^[]*?url\s*=\s*(.+)/)?.[1]?.trim() ?? null;

	return {
		path,
		name: repoName(path),
		branch,
		active: newest ? new Date(newest).toISOString() : null,
		remote: origin
	};
}

// a scan takes a moment, reuse it for a while unless a rescan is asked for
const store = globalThis as { __repoScan?: { at: number; scan: Promise<Scan> } };
const FRESH_MS = 10 * 60_000;

export function cachedScan(refresh = false): Promise<Scan> {
	const cached = store.__repoScan;
	if (!refresh && cached && Date.now() - cached.at < FRESH_MS) return cached.scan;
	const scan = scanRepos();
	store.__repoScan = { at: Date.now(), scan };
	scan.catch(() => (store.__repoScan = undefined));
	return scan;
}
