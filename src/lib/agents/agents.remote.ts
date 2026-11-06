import { command, getRequestEvent, query } from '$app/server';
import {
	addWorktree,
	branchFor,
	busyIn,
	checkSessionId,
	checkWorktree,
	createSession,
	decide,
	forkAndSend,
	interrupt,
	stopTask,
	listModels,
	listSessions,
	listWorktrees,
	loadSettings,
	mainCheckout,
	markSeen,
	openClaudeSession,
	saveSettings,
	send,
	setMode,
	setEffort,
	setOpen,
	setModel,
	watchSession
} from '$lib/server/agents';
import {
	abortOperation,
	baseRef,
	fetchIfDue,
	fetchNow,
	fetchState,
	pull,
	rebase,
	syncOf
} from '$lib/server/sync';
import { listen, notify, Watchers } from '$lib/server/watch';
import { badRequestOnError } from '$lib/server/requests';
import { loadScripts, openTerminal } from '$lib/server/terminals';
import {
	EFFORTS,
	MODES,
	type AgentSettings,
	type Effort,
	type Mode,
	type WorktreeStatus
} from './types';

type Ref = { repo: string; id: string };

const checkMode = (mode: unknown): Mode => {
	if (!MODES.some((m) => m.value === mode)) throw new Error('Not a permission mode');
	return mode as Mode;
};

const checkEffort = (effort: unknown): Effort => {
	if (!EFFORTS.some((e) => e.value === effort)) throw new Error('Not an effort level');
	return effort as Effort;
};

// an alias or a model id, Claude Code says whether it knows it
const checkModel = (model: unknown): string => {
	if (typeof model !== 'string' || !/^[\w.\-[\]]+$/.test(model)) throw new Error('Not a model');
	return model;
};

/** The repo's worktrees, where each stands and the agent sessions in each, and its last fetch. */
async function snapshot(main: string) {
	const trees = await listWorktrees(main);
	const [sessions, base] = await Promise.all([
		listSessions(
			main,
			trees.map((t) => t.path)
		),
		baseRef(main)
	]);
	const stats = await Promise.all(trees.map((t) => syncOf(t.path, t.main ? null : base)));
	const worktrees: WorktreeStatus[] = trees.map((tree, i) => ({
		...tree,
		...stats[i],
		sessions: sessions.filter((s) => s.cwd === tree.path)
	}));
	return { worktrees, base, fetch: fetchState(main) };
}

/** what's left after a burst of changes before it's read again, a rebase rewriting many files */
const SETTLE_MS = 300;
/** how often the remote is fetched while someone looks: nothing tells of it moving on */
const FETCH_EVERY_MS = 60_000;

/**
 * The repo's worktrees and sessions, wherever in the repo `repo` is: now, then again each time
 * something about them changes, rather than asked for every few seconds. Watched while followed:
 * the sessions, fetches, each worktree's git and its files, see Watchers.
 */
export const followWorktrees = query.live('unchecked', async function* (repo: string) {
	const main = await badRequestOnError(() => mainCheckout(repo));
	const signal = getRequestEvent().request.signal;
	const watchers = new Watchers(main);
	let dirty = false;
	let wake: (() => void) | undefined;
	const stopListening = listen(main, () => {
		dirty = true;
		wake?.();
	});
	signal.addEventListener('abort', () => wake?.());
	let now = await snapshot(main);
	const fetchSoon = () => fetchIfDue(main, () => autoPull(now.worktrees, now.base));
	const fetching = setInterval(fetchSoon, FETCH_EVERY_MS);
	try {
		fetchSoon();
		for (;;) {
			await watchers.follow(now.worktrees.map((t) => t.path));
			yield now;
			if (!dirty) await new Promise<void>((resolve) => (wake = resolve));
			if (signal.aborted) return;
			await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
			dirty = false;
			now = await snapshot(main);
		}
	} finally {
		clearInterval(fetching);
		stopListening();
		watchers.close();
	}
});

/**
 * After a fetch, with the setting on: the main checkout pulled when it's on the default branch,
 * clean, with nothing of its own and nobody working in it, t3code's rule.
 */
async function autoPull(trees: WorktreeStatus[], base: string | null) {
	if (!(await loadSettings()).autoPull) return;
	const tree = trees.find((t) => t.main);
	if (!tree || !base || tree.branch !== base.replace(/^[^/]+\//, '')) return;
	const sync = await syncOf(tree.path, null);
	if (!sync.behind || sync.ahead || sync.dirty || sync.conflicts || busyIn(tree.path)) return;
	await pull(tree.path).catch(() => {});
}

/** Fetches now. */
export const fetchRepo = command('unchecked', (repo: string) =>
	badRequestOnError(async () => {
		// the stream reads it again once it's done, a fetch tells of itself
		await fetchNow(await mainCheckout(repo));
	})
);

/** The worktree, when git may act in it: not while an agent works there. */
async function idle(repo: string, cwd: string) {
	const main = await mainCheckout(repo);
	const path = await checkWorktree(main, cwd);
	if (busyIn(path))
		throw new Error('An agent is working in this worktree, wait for its turn to end');
	return path;
}

/** Fast-forwards the worktree to its upstream. */
export const pullWorktree = command('unchecked', ({ repo, cwd }: { repo: string; cwd: string }) =>
	badRequestOnError(async () => {
		const done = await pull(await idle(repo, cwd));
		notify(await mainCheckout(repo));
		return done;
	})
);

/** Rebases the worktree onto the base, the files in conflict when it stops on them. */
export const rebaseWorktree = command('unchecked', ({ repo, cwd }: { repo: string; cwd: string }) =>
	badRequestOnError(async () => {
		const path = await idle(repo, cwd);
		const base = await baseRef(await mainCheckout(repo));
		if (!base) throw new Error('There is no origin/main to rebase onto');
		const done = await rebase(path, base);
		notify(await mainCheckout(repo));
		return done;
	})
);

/** Gives up on the rebase, merge, cherry-pick or revert the worktree is stopped in. */
export const abortWorktree = command('unchecked', ({ repo, cwd }: { repo: string; cwd: string }) =>
	badRequestOnError(async () => {
		await abortOperation(await idle(repo, cwd));
		notify(await mainCheckout(repo));
	})
);

/** Starts an agent in `cwd` on `text`, the session's id. */
export const startSession = command(
	'unchecked',
	({
		repo,
		cwd,
		text,
		mode,
		model,
		effort,
		base
	}: {
		repo: string;
		/** the worktree, unless it's a new one */
		cwd?: string;
		text: string;
		mode: Mode;
		model: string;
		effort: Effort;
		/** a new worktree off this, on a branch named after `text` */
		base?: string;
	}) =>
		badRequestOnError(async () => {
			const main = await mainCheckout(repo);
			if (!text.trim()) throw new Error('Say what to do first');
			const where =
				base !== undefined
					? await addWorktree(main, await branchFor(main, text), base)
					: await checkWorktree(main, cwd ?? '');
			// alongside the agent, as Conductor's does, in a terminal of its own to watch
			const { setup } = await loadScripts(main);
			if (base !== undefined && setup) openTerminal(where, main, 'Setup', setup);
			const id = await createSession(
				main,
				where,
				text,
				checkMode(mode),
				checkModel(model),
				checkEffort(effort)
			);
			notify(await mainCheckout(repo));
			return { id, cwd: where };
		})
);

/** Puts a session in the sidebar, or takes it out, stopping it. */
export const setSessionOpen = command('unchecked', ({ repo, id, open }: Ref & { open: boolean }) =>
	badRequestOnError(async () => {
		await setOpen(await mainCheckout(repo), checkSessionId(id), open === true);
		notify(await mainCheckout(repo));
	})
);

/** The session was looked at, what it last did isn't unread. */
export const seeSession = command('unchecked', ({ repo, id }: Ref) =>
	badRequestOnError(async () => {
		await markSeen(await mainCheckout(repo), checkSessionId(id));
		notify(await mainCheckout(repo));
	})
);

/** The session as it is, then as it changes. */
export const followSession = query.live('unchecked', async function* ({ repo, id }: Ref) {
	const main = await badRequestOnError(() => mainCheckout(repo));
	const signal = getRequestEvent().request.signal;
	yield* watchSession(main, checkSessionId(id), signal);
});

/** Sends, unless another Claude Code may have the session open and it isn't `force`d. */
export const sendMessage = command(
	'unchecked',
	({ repo, id, text, force }: Ref & { text: string; force?: boolean }) =>
		badRequestOnError(async () => {
			if (!text.trim()) throw new Error('Say something first');
			return send(await mainCheckout(repo), checkSessionId(id), text, force === true);
		})
);

/** Sends in a copy of the session, the fork's id. */
export const forkAndSendMessage = command(
	'unchecked',
	({ repo, id, text }: Ref & { text: string }) =>
		badRequestOnError(async () => {
			if (!text.trim()) throw new Error('Say something first');
			const fork = await forkAndSend(await mainCheckout(repo), checkSessionId(id), text);
			notify(await mainCheckout(repo));
			return fork;
		})
);

/** A session of Claude Code's own, from a terminal, opened here: the app's id for it. */
export const openClaudeCodeSession = command(
	'unchecked',
	({ repo, cwd, claude }: { repo: string; cwd: string; claude: string }) =>
		badRequestOnError(async () => {
			const main = await mainCheckout(repo);
			const id = await openClaudeSession(
				main,
				await checkWorktree(main, cwd),
				checkSessionId(claude)
			);
			notify(await mainCheckout(repo));
			return id;
		})
);

export const stopTurn = command('unchecked', ({ repo, id }: Ref) =>
	badRequestOnError(async () => interrupt(await mainCheckout(repo), checkSessionId(id)))
);

export const stopAgent = command('unchecked', ({ repo, id, taskId }: Ref & { taskId: string }) =>
	badRequestOnError(async () =>
		stopTask(await mainCheckout(repo), checkSessionId(id), String(taskId))
	)
);

export const changeMode = command('unchecked', ({ repo, id, mode }: Ref & { mode: Mode }) =>
	badRequestOnError(async () =>
		setMode(await mainCheckout(repo), checkSessionId(id), checkMode(mode))
	)
);

export const changeModel = command('unchecked', ({ repo, id, model }: Ref & { model: string }) =>
	badRequestOnError(async () =>
		setModel(await mainCheckout(repo), checkSessionId(id), checkModel(model))
	)
);

export const changeEffort = command('unchecked', ({ repo, id, effort }: Ref & { effort: Effort }) =>
	badRequestOnError(async () =>
		setEffort(await mainCheckout(repo), checkSessionId(id), checkEffort(effort))
	)
);

/** The models the user's Claude Code offers, its default first. */
export const getModels = query('unchecked', (repo: string) =>
	badRequestOnError(async () => listModels(await mainCheckout(repo)))
);

export const answerApproval = command(
	'unchecked',
	({
		repo,
		id,
		approval,
		decision
	}: Ref & { approval: string; decision: 'allow' | 'always' | 'deny' }) =>
		badRequestOnError(async () => {
			if (!['allow', 'always', 'deny'].includes(decision)) throw new Error('Allow or deny');
			await decide(await mainCheckout(repo), checkSessionId(id), approval, decision);
		})
);

export const getAgentSettings = query(() => loadSettings());

export const setAgentSettings = command('unchecked', (settings: AgentSettings) =>
	badRequestOnError(async () => {
		const next: AgentSettings = {
			wrapper: String(settings.wrapper ?? '').trim(),
			sandbox: settings.sandbox === true,
			mode: checkMode(settings.mode),
			model: checkModel(settings.model),
			effort: checkEffort(settings.effort),
			autoPull: settings.autoPull === true
		};
		await saveSettings(next);
		getAgentSettings().set(next);
		return next;
	})
);
