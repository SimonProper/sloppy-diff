import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { FetchState, Operation, Sync } from '$lib/agents/types';
import { log } from './log';

const exec = promisify(execFile);

/**
 * git with nobody at a terminal: it fails rather than asking for a password or a passphrase,
 * and a message for a commit is taken as it is rather than an editor opened for it.
 */
export async function run(cwd: string, args: string[], timeout = 60_000): Promise<string> {
	return (await told(cwd, args, timeout)).stdout;
}

/** run's, and what git said on stderr too, where it tells of an autostash that didn't apply. */
async function told(cwd: string, args: string[], timeout = 60_000) {
	return exec('git', ['-C', cwd, ...args], {
		timeout,
		maxBuffer: 16 * 1024 * 1024,
		env: {
			...process.env,
			GIT_TERMINAL_PROMPT: '0',
			// a status read doesn't refresh the index, which is watched: each read would be a change
			GIT_OPTIONAL_LOCKS: '0',
			// its messages in English, an autostash's conflict is told by them
			LC_ALL: 'C',
			GIT_EDITOR: 'true',
			GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes'
		}
	});
}

const quiet = (cwd: string, args: string[]) => run(cwd, args).catch(() => '');

/**
 * The worktree's state in one spawn, git's porcelain v2 status: its upstream and how far from
 * it, anything uncommitted, untracked files too, and the files in conflict. NUL separated, so
 * a path is never quoted. Each spawn is paid on the thread Electron takes input on.
 */
async function statusOf(path: string) {
	const records = (await quiet(path, ['status', '--porcelain=v2', '--branch', '-z'])).split('\0');
	let upstream: string | undefined;
	let ab: { ahead: number; behind: number } | undefined;
	let dirty = false;
	const unmerged: string[] = [];
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (!record) continue;
		if (record.startsWith('# branch.upstream ')) upstream = record.slice(18);
		else if (record.startsWith('# branch.ab ')) {
			const [ahead, behind] = record
				.slice(12)
				.split(' ')
				.map((n) => Math.abs(Number(n)));
			ab = { ahead, behind };
		} else if (record[0] !== '#') {
			dirty = true;
			// `u XY sub m1 m2 m3 mW h1 h2 h3 path`
			if (record[0] === 'u') unmerged.push(record.split(' ').slice(10).join(' '));
			// a rename's record is followed by the path it had
			else if (record[0] === '2') i++;
		}
	}
	return { upstream, ab, dirty, unmerged };
}

const unmergedIn = async (path: string) => (await statusOf(path)).unmerged;

// ---- fetching, once for all of a repo's worktrees, as t3code does it

/** how often, while a page shows the repo, and the most a failure backs off to */
const EVERY_MS = 60_000;
const MOST_MS = 15 * 60_000;

interface Fetching {
	at?: number;
	error?: string;
	running?: Promise<void>;
	/** not before then, after a failure */
	next: number;
	failures: number;
}

// kept on globalThis so a dev server module reload doesn't fetch again at once
const store = globalThis as { __fetches?: Map<string, Fetching> };
const fetches = (store.__fetches ??= new Map<string, Fetching>());

function stateOf(main: string): Fetching {
	const found = fetches.get(main);
	if (found) return found;
	const state: Fetching = { next: 0, failures: 0 };
	fetches.set(main, state);
	return state;
}

export function fetchState(main: string): FetchState {
	const { at, error, running } = stateOf(main);
	return { at, error, fetching: !!running };
}

/** Fetches now, or joins the fetch that's running. Never throws, what went wrong is kept. */
export function fetchNow(main: string, then?: () => Promise<void>): Promise<void> {
	const state = stateOf(main);
	state.running ??= run(main, ['fetch', '--quiet', '--no-tags', '--no-auto-gc', '--prune'])
		.then(
			async () => {
				state.at = Date.now();
				state.error = undefined;
				state.failures = 0;
				state.next = state.at + EVERY_MS;
				await then?.();
			},
			(e: { stderr?: string; message?: string }) => {
				state.error = String(e.stderr || e.message || e)
					.trim()
					.split('\n')[0];
				state.failures++;
				state.next = Date.now() + Math.min(EVERY_MS * 2 ** state.failures, MOST_MS);
				log('git', `fetch in ${main} failed: ${state.error}`);
			}
		)
		.finally(() => {
			state.running = undefined;
			fetched(main);
		});
	return state.running;
}

/** told when a repo's fetch is done, either way: the counts, or why it failed, are news */
let fetched: (main: string) => void = () => {};
export function whenFetched(listener: (main: string) => void) {
	fetched = listener;
}

/** Fetches when it's time to, without waiting on it: the counts are fresh by the next look. */
export function fetchIfDue(main: string, then?: () => Promise<void>) {
	const state = stateOf(main);
	if (!state.running && Date.now() >= state.next) void fetchNow(main, then);
}

// ---- where a worktree stands

/** The remote's default branch, `origin/main`, what worktrees start from and rebase onto. */
export async function baseRef(main: string): Promise<string | null> {
	const head = (
		await quiet(main, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
	).trim();
	if (head) return head;
	for (const ref of ['origin/main', 'origin/master']) {
		if ((await quiet(main, ['rev-parse', '--verify', '--quiet', ref])).trim()) return ref;
	}
	return null;
}

const counts = (text: string) => {
	const [left, right] = text.trim().split(/\s+/).map(Number);
	return text.trim() ? { left, right } : null;
};

/**
 * How far the worktree is from its upstream and from the base, what it has uncommitted, and
 * a rebase it's stopped in.
 */
export async function syncOf(path: string, base: string | null): Promise<Sync> {
	// four spawns: the status, the base, the lines changed, and an operation stopped midway
	const [status, onBase, short, operation] = await Promise.all([
		statusOf(path),
		base ? quiet(path, ['rev-list', '--left-right', '--count', `${base}...HEAD`]) : '',
		quiet(path, ['diff', '--shortstat', 'HEAD']),
		operationIn(path)
	]);
	const { unmerged } = status;
	// a branch made off origin/main often tracks it: then its upstream is the base, counted once,
	// as the base
	const up = base && status.upstream === base ? null : status.ab;
	const fromBase = counts(onBase);
	const lines = (kind: string) => Number(new RegExp(`(\\d+) ${kind}`).exec(short)?.[1] ?? 0);
	// an autostash's conflict is only known from the pull or rebase that made it, until it's resolved
	if (!unmerged.length) stashed.delete(path);
	return {
		...(up && { behind: up.behind, ahead: up.ahead }),
		...(fromBase && base && { base, behindBase: fromBase.left, aheadBase: fromBase.right }),
		added: lines('insertion'),
		removed: lines('deletion'),
		dirty: status.dirty,
		...(operation && { operation }),
		...(!operation && unmerged.length > 0 && stashed.has(path) && { stashConflict: true as const }),
		...((operation || unmerged.length > 0) && { conflicts: unmerged })
	};
}

/** The operation git is stopped in, from the files it keeps while it is. */
async function operationIn(path: string): Promise<Operation | undefined> {
	const marks: [string, Operation][] = [
		['rebase-merge', 'rebase'],
		['rebase-apply', 'rebase'],
		['MERGE_HEAD', 'merge'],
		['CHERRY_PICK_HEAD', 'cherry-pick'],
		['REVERT_HEAD', 'revert']
	];
	// one spawn, a line for each
	const paths = (
		await quiet(path, ['rev-parse', ...marks.flatMap(([mark]) => ['--git-path', mark])])
	).split('\n');
	// --git-path is relative to the worktree
	const exists = (p: string) =>
		p.trim() && existsSync(p.trim().startsWith('/') ? p.trim() : `${path}/${p.trim()}`);
	return marks.find((_, i) => exists(paths[i]))?.[1];
}

/** worktrees whose pull or rebase left an autostash in conflict, by path */
const store2 = globalThis as { __stashed?: Set<string> };
const stashed = (store2.__stashed ??= new Set<string>());

// ---- what can be done about it

/**
 * What's uncommitted, put back after: lazygit's autostash, so a worktree with work in it can
 * be brought up to date too. Where it doesn't go back cleanly git leaves conflict markers in
 * the files and keeps the stash, and says so only on stderr.
 */
async function stashedBack(path: string, said: { stderr: string }) {
	if (!/Applying autostash resulted in conflicts/.test(said.stderr)) return {};
	stashed.add(path);
	return { stashConflicts: await unmergedIn(path) };
}

/** Brings the worktree up to its upstream, only by fast-forwarding: no merge, no conflict. */
export async function pull(path: string): Promise<{ stashConflicts?: string[] }> {
	return stashedBack(path, await told(path, ['merge', '--ff-only', '--autostash', '@{upstream}']));
}

/**
 * Rebases onto the base. Stopped on conflicts, they're left for the agent or an abort, the
 * stash held until the rebase ends either way.
 */
export async function rebase(
	path: string,
	base: string
): Promise<{ conflicts?: string[]; stashConflicts?: string[] }> {
	try {
		return stashedBack(path, await told(path, ['rebase', '--autostash', '--quiet', base]));
	} catch (error) {
		const conflicts = await unmergedIn(path);
		if (conflicts.length) return { conflicts };
		throw error;
	}
}

/** Gives up on the operation git is stopped in, back to before it. */
export async function abortOperation(path: string) {
	const operation = await operationIn(path);
	if (!operation) throw new Error('Nothing is in progress to abort');
	await run(path, [operation, '--abort']);
}
