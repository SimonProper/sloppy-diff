import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import {
	forkSession,
	getSessionInfo,
	getSessionMessages,
	listSessions as listClaudeSessions,
	query,
	type CanUseTool,
	type Options,
	type Query,
	type SDKBackgroundTasksChangedMessage,
	type SDKMessage,
	type SDKTaskNotificationMessage,
	type SDKTaskProgressMessage,
	type SDKTaskStartedMessage,
	type SDKTaskUpdatedMessage,
	type SessionMessage,
	type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk';
import { env } from '$env/dynamic/private';
import { firstLine } from '$lib/markdown';
import { slugOf } from '$lib/agents/branch';
import type {
	AgentSettings,
	Effort,
	Item,
	Mode,
	ModelOption,
	Session,
	SessionSummary,
	Task,
	Worktree
} from '$lib/agents/types';
import { git } from './git';
import { repoDir } from './guides';
import { log } from './log';
import { fetchNow, run } from './sync';
import { notify } from './watch';

// ---- worktrees

/** The repo's worktrees, the main checkout first, as git lists them. */
export async function listWorktrees(
	repo: string
): Promise<Pick<Worktree, 'path' | 'head' | 'branch' | 'main'>[]> {
	// read every few seconds by the sidebar: unlogged, as sync's status reads are
	const out = await run(repo, ['worktree', 'list', '--porcelain']);
	return out
		.trim()
		.split('\n\n')
		.map((block, i) => {
			const field = (key: string) =>
				block
					.split('\n')
					.find((line) => line.startsWith(`${key} `))
					?.slice(key.length + 1);
			return {
				path: field('worktree') ?? '',
				head: field('HEAD') ?? '',
				branch: field('branch')?.replace(/^refs\/heads\//, '') ?? null,
				main: i === 0
			};
		})
		.filter((w) => w.path && !w.path.endsWith('.bare'));
}

/** The repo's main checkout, where its sessions are filed, whichever worktree `repo` is. */
export async function mainCheckout(repo: string): Promise<string> {
	// a repo's main checkout doesn't move, asked of git once for each place in it
	let found = mains.get(repo);
	if (!found) {
		found = listWorktrees(repo).then((trees) => trees[0].path);
		mains.set(repo, found);
		found.catch(() => mains.delete(repo));
	}
	return found;
}

const mains = new Map<string, Promise<string>>();

/** `cwd` when it's one of the repo's worktrees, the only places an agent is started in. */
export async function checkWorktree(repo: string, cwd: string): Promise<string> {
	if (!(await listWorktrees(repo)).some((w) => w.path === cwd)) {
		throw new Error(`${cwd} isn't a worktree of ${repo}`);
	}
	return cwd;
}

/** A branch named after what a session is asked, as Intent names its workspaces: free in the repo. */
export async function branchFor(repo: string, text: string): Promise<string> {
	const slug = slugOf(text);
	const taken = new Set(
		(await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split('\n')
	);
	let name = slug;
	for (let n = 2; taken.has(name); n++) name = `${slug}-${n}`;
	return name;
}

/** A new branch off `base`, checked out in a worktree of its own next to the others the app made. */
export async function addWorktree(repo: string, branch: string, base: string): Promise<string> {
	const main = await mainCheckout(repo);
	branch = (await git(main, ['check-ref-format', '--branch', branch.trim()])).trim();
	if (base.startsWith('-')) throw new Error(`${base} isn't a branch`);
	const root = env.WORKTREES_DIR || join(homedir(), '.sloppy-diff', 'worktrees');
	const path = join(root, basename(main), branch.replaceAll('/', '-'));
	// off the remote's copy of the base as it is now, as t3code, Conductor and Claude Code do,
	// not a local one that may be behind. Not tracking it, its upstream is its own once pushed
	await fetchNow(main);
	const remote =
		base &&
		(await git(main, ['rev-parse', '--verify', '--quiet', `origin/${base}`]).then(
			() => `origin/${base}`,
			() => null
		));
	await git(main, ['worktree', 'add', '--no-track', '-b', branch, path, remote || base || 'HEAD']);
	return path;
}

// ---- settings

// the user's, not the checkout's: the dev server and the app read the same ones
const settingsDir = join(homedir(), '.sloppy-diff');
const settingsPath = () => join(settingsDir, 'agent-settings.json');
const DEFAULTS: AgentSettings = {
	wrapper: '',
	sandbox: true,
	mode: 'auto',
	model: 'default',
	effort: 'default',
	autoPull: false
};

export async function loadSettings(): Promise<AgentSettings> {
	const saved = await readFile(settingsPath(), 'utf8').then(JSON.parse, () => ({}));
	return { ...DEFAULTS, ...saved };
}

/** Saves them, and has every session's process start again with them, once it's between turns. */
export async function saveSettings(settings: AgentSettings): Promise<void> {
	await mkdir(settingsDir, { recursive: true });
	await writeFile(settingsPath(), JSON.stringify(settings, null, '\t'));
	for (const entry of sessions.values()) {
		if (!entry.query) continue;
		if (entry.session.status === 'idle' && !entry.session.tasks?.length) stop(entry);
		else entry.restart = true;
	}
}

/** The wrapper's words, quotes kept together, `{worktree}` and `{repo}` filled in. */
export function wrapperArgs(wrapper: string, worktree: string, repo: string): string[] {
	return (wrapper.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((word) =>
		word
			.replace(/^(["'])(.*)\1$/, '$2')
			.replaceAll('{worktree}', worktree)
			.replaceAll('{repo}', repo)
	);
}

// ---- sessions

/** A session's process while it has one, and who's watching. */
interface Live {
	session: Session;
	query?: Query;
	inbox?: Inbox;
	approvals: Map<string, (decision: 'allow' | 'always' | 'deny') => void>;
	listeners: Set<() => void>;
	/** what the process has reported spending so far, its result's totals add up */
	spent: number;
	/** when another Claude Code, a terminal's, last wrote to the session as far as seen, in ms */
	elsewhereAt?: number;
	/** the settings changed while it worked: it stops once the turn is over */
	restart?: boolean;
	/** stops the process once it's been idle a while */
	idle?: ReturnType<typeof setTimeout>;
	/** messages sent to the process it hasn't taken up yet, by id: a turn comes for them */
	pending: Set<string>;
	/** when the process last said anything */
	heardAt?: number;
	/** what the sidebar last showed of it, see changed */
	shown?: string;
}

export const fresh = (session: Session): Live => ({
	session,
	approvals: new Map(),
	listeners: new Set(),
	spent: 0,
	pending: new Set()
});

/**
 * How long a process waits for the next message before it stops, freeing its memory and the
 * session for a terminal. The next message resumes it, a second or two to start again.
 */
const IDLE_MS = 10 * 60_000;

/** Ends the session's process, the next message starts another, resumed. */
function stop(entry: Live) {
	clearTimeout(entry.idle);
	const q = entry.query;
	entry.inbox?.close();
	// gone at once, so a message sent meanwhile starts another rather than going to this one
	ended(entry);
	q?.close();
}

/** What's left of a process that ended or was stopped: nothing to answer approvals, no status. */
function ended(entry: Live) {
	clearTimeout(entry.idle);
	entry.query = undefined;
	entry.inbox = undefined;
	entry.restart = false;
	entry.pending.clear();
	entry.session.status = 'closed';
	entry.session.tasks = [];
	entry.session.syncedAt = Date.now();
	for (const resolve of entry.approvals.values()) resolve('deny');
	changed(entry);
}

// Claude Code finishes writing a transcript a moment after it says it's done
const SYNC_SLACK_MS = 5000;
// ponytail: a session written to elsewhere this recently may still be open there, a guess;
// a lock file of Claude Code's own, if it gets one, would know
const BUSY_MS = 10 * 60_000;

// kept on globalThis so a dev server module reload doesn't orphan running agents
const store = globalThis as { __agentSessions?: Map<string, Live> };
const sessions = (store.__agentSessions ??= new Map<string, Live>());

const sessionsDir = (repo: string) => join(repoDir(repo), 'agent-sessions');
const sessionPath = (repo: string, id: string) => join(sessionsDir(repo), `${id}.json`);

export function checkSessionId(id: string): string {
	if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Not a session id');
	return id;
}

async function save(session: Session) {
	await mkdir(sessionsDir(session.repo), { recursive: true });
	await writeFile(sessionPath(session.repo, session.id), JSON.stringify(session));
}

function changed(live: Live) {
	for (const listener of live.listeners) listener();
	// the sidebar only for what it shows, not each word streamed
	const { open, title, doneAt, seenAt, items, syncedAt } = live.session;
	const waiting = items.some((i) => i.type === 'approval' && !i.decision);
	const shown = JSON.stringify([
		shownStatus(live.session),
		open,
		title,
		doneAt,
		seenAt,
		waiting,
		syncedAt
	]);
	if (shown !== live.shown) {
		live.shown = shown;
		notify(live.session.repo);
	}
}

/** The session, from memory while it has a process or was looked at, else as it was saved. */
async function live(repo: string, id: string): Promise<Live> {
	const found = sessions.get(id);
	if (found) return found;
	// two asking at once share the one read, rather than each having a copy of their own
	let reading = loading.get(id);
	if (!reading) {
		reading = (async () => {
			const session: Session = JSON.parse(await readFile(sessionPath(repo, id), 'utf8'));
			// its process went with the server that ran it
			const entry = fresh({ ...session, status: 'closed', tasks: [] });
			sessions.set(id, entry);
			await catchUp(entry);
			return entry;
		})().finally(() => loading.delete(id));
		loading.set(id, reading);
	}
	return reading;
}

const loading = new Map<string, Promise<Live>>();

/**
 * Reads the session again from Claude Code's transcript when something else wrote to it since,
 * like a terminal resuming it. What only the app knew, approvals and what turns cost, goes.
 */
async function catchUp(entry: Live) {
	const { session } = entry;
	if (entry.query || !session.claudeSession) return;
	const info = await getSessionInfo(session.claudeSession, { dir: session.cwd });
	// a session nothing was sent to from here is only the terminal's, read as the reader reads now
	const theirs = !session.items.some((i) => i.type === 'user' && i.at);
	const behind = info && info.lastModified > (session.syncedAt ?? 0) + SYNC_SLACK_MS;
	if (!info || (!behind && !theirs)) return;
	const read = await transcript(session.claudeSession, session.cwd);
	// Claude Code writes the odd line after a turn, a title, its last prompt: only a message
	// typed somewhere else means someone carried on there
	const asked = (items: Item[]) => items.filter((i) => i.type === 'user').length;
	if (!theirs && asked(read) <= asked(session.items)) {
		session.syncedAt = info.lastModified;
		await save(session);
		return;
	}
	session.items = read;
	session.syncedAt = entry.elsewhereAt = info.lastModified;
	changed(entry);
	await save(session);
}

/** The session as Claude Code shows it on resume, from before its compactions too. */
async function transcript(claudeSession: string, cwd: string): Promise<Item[]> {
	const file = await transcriptFile(claudeSession, cwd);
	const messages = file
		? stitch((await readFile(file, 'utf8')).split('\n'))
		: // where Claude Code keeps them elsewhere, the SDK still reads them, since the last compaction
			await getSessionMessages(claudeSession, { dir: cwd });
	return fromTranscript(messages, cwd);
}

/** Claude Code's file of the session, in the project folder named after `cwd`, else wherever it is. */
async function transcriptFile(claudeSession: string, cwd: string): Promise<string | null> {
	const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
	const file = `${claudeSession}.jsonl`;
	const named = join(projects, cwd.replace(/[^a-zA-Z0-9]/g, '-'), file);
	const dirs = [
		named,
		...(await readdir(projects).catch(() => [])).map((d) => join(projects, d, file))
	];
	for (const path of dirs) {
		if (
			await access(path).then(
				() => true,
				() => false
			)
		)
			return path;
	}
	return null;
}

/**
 * A transcript file's messages as Claude Code resumes them: back from the last message along
 * the branch it's on, and across each compaction to the conversation it summarised, where the
 * SDK's reading stops. A compaction is a `system` message in its place, its summary left out.
 */
export function stitch(lines: string[]): SessionMessage[] {
	type Row = {
		type: string;
		subtype?: string;
		uuid?: string;
		parentUuid?: string | null;
		logicalParentUuid?: string;
		isSidechain?: boolean;
		isMeta?: boolean;
		isCompactSummary?: boolean;
		/** who a user message is from: `human` typed it, a subagent's report or a task's notice didn't */
		origin?: { kind: string };
		message?: unknown;
		sessionId?: string;
	};
	const rows: Row[] = [];
	for (const line of lines) {
		try {
			if (line.trim()) rows.push(JSON.parse(line));
		} catch {
			// a line still being written
		}
	}
	const byId = new Map(rows.filter((r) => r.uuid).map((r) => [r.uuid!, r]));
	const said = (r: Row) => (r.type === 'user' || r.type === 'assistant') && !r.isSidechain;
	// what the terminal doesn't show as yours: a subagent reporting back, a background task's
	// notice. Tool results come back as user messages too, and stay
	const foreign = (r: Row) =>
		r.type === 'user' &&
		r.origin !== undefined &&
		r.origin.kind !== 'human' &&
		!JSON.stringify((r.message as { content?: unknown })?.content ?? '').includes('"tool_result"');
	const chain: Row[] = [];
	const seen = new Set<string>();
	for (let row = rows.findLast(said); row && !seen.has(row.uuid!);) {
		seen.add(row.uuid!);
		chain.push(row);
		const compacted = row.parentUuid == null && row.subtype === 'compact_boundary';
		row = byId.get((compacted ? row.logicalParentUuid : row.parentUuid) ?? '');
	}
	return chain
		.reverse()
		.filter(
			(r) =>
				r.subtype === 'compact_boundary' ||
				(said(r) && !r.isMeta && !r.isCompactSummary && !foreign(r))
		)
		.map((r) => ({
			type: r.subtype === 'compact_boundary' ? 'system' : (r.type as 'user' | 'assistant'),
			uuid: r.uuid!,
			session_id: r.sessionId ?? '',
			message: r.message,
			parent_tool_use_id: null,
			parent_agent_id: null
		}));
}

/** A transcript of Claude Code's as the session's items. Its commands and reminders are left out. */
export function fromTranscript(messages: SessionMessage[], cwd: string): Item[] {
	const items: Item[] = [];
	const tools = new Map<string, Extract<Item, { type: 'tool' }>>();
	type Block = { type: string; [key: string]: unknown };
	for (const { type, message, parent_tool_use_id } of messages) {
		if (parent_tool_use_id) continue;
		const content = (message as { content?: string | Block[] })?.content;
		const blocks: Block[] =
			typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? []);
		if (type === 'user') {
			for (const block of blocks.filter((b) => b.type === 'tool_result')) {
				const tool = tools.get(String(block.tool_use_id));
				if (!tool) continue;
				tool.failed = block.is_error === true;
				tool.output = cut(resultText(block.content), 6000);
			}
			const text = blocks
				.filter((b) => b.type === 'text')
				.map((b) => String(b.text))
				.join('\n\n')
				.trim();
			// what the terminal adds itself: /commands, their output, reminders
			// a stop pressed in the terminal, as it shows it
			if (/^\[Request interrupted by user/.test(text)) {
				items.push({ type: 'notice', text: 'Stopped' });
			} else if (text && !/^<[a-z-]+>/.test(text) && !text.startsWith('Caveat: ')) {
				items.push({ type: 'user', id: randomUUID(), text, at: '' });
			}
		} else if (type === 'system') {
			items.push({ type: 'notice', text: 'Compacted the conversation' });
		} else if (type === 'assistant') {
			for (const block of blocks) {
				if (block.type === 'text' && String(block.text).trim()) {
					items.push({ type: 'text', text: String(block.text) });
				} else if (block.type === 'thinking' && String(block.thinking ?? '').trim()) {
					items.push({ type: 'thinking', text: String(block.thinking) });
				} else if (block.type === 'tool_use') {
					const name = String(block.name);
					const input = (block.input ?? {}) as Record<string, unknown>;
					const tool = {
						type: 'tool' as const,
						id: String(block.id),
						name,
						...describe(name, input, cwd),
						done: true
					};
					tools.set(tool.id, tool);
					items.push(tool);
				}
			}
		}
	}
	return items;
}

/** A session of Claude Code's own, from a terminal, here to carry on. The app's when it has it already. */
export function openClaudeSession(
	repo: string,
	cwd: string,
	claudeSession: string,
	/** what a fork starts from, its mode, model and effort */
	from?: Session
): Promise<string> {
	// opened twice at once, a double click, it's still the one session
	let opening = openings.get(claudeSession);
	if (!opening) {
		opening = openOnce(repo, cwd, claudeSession, from).finally(() =>
			openings.delete(claudeSession)
		);
		openings.set(claudeSession, opening);
	}
	return opening;
}

const openings = new Map<string, Promise<string>>();

async function openOnce(repo: string, cwd: string, claudeSession: string, from?: Session) {
	const files = await readdir(sessionsDir(repo)).catch(() => []);
	for (const file of files.filter((f) => f.endsWith('.json'))) {
		const saved: Session = JSON.parse(await readFile(join(sessionsDir(repo), file), 'utf8'));
		if (saved.claudeSession === claudeSession) {
			await setOpen(repo, saved.id, true);
			return saved.id;
		}
	}
	const info = await getSessionInfo(claudeSession, { dir: cwd });
	if (!info) throw new Error("Claude Code doesn't have that session anymore");
	const settings = await loadSettings();
	const session: Session = {
		id: randomUUID(),
		repo,
		cwd,
		title: info.customTitle || info.summary,
		createdAt: new Date(info.createdAt ?? info.lastModified).toISOString(),
		claudeSession,
		syncedAt: info.lastModified,
		open: true,
		seenAt: Date.now(),
		mode: from?.mode ?? settings.mode,
		model: from?.model ?? settings.model,
		effort: from?.effort ?? settings.effort,
		status: 'closed',
		items: await transcript(claudeSession, cwd),
		cost: 0,
		// a fork's Claude Code carries on from what the session it came from had spent
		...(from?.costTotal !== undefined && { costTotal: from.costTotal })
	};
	// a fork is the app's alone, the session it came from may be open elsewhere
	sessions.set(session.id, { ...fresh(session), ...(!from && { elsewhereAt: info.lastModified }) });
	await save(session);
	return session.id;
}

/** Carries on in a copy of the session, leaving the one that may be open elsewhere alone. */
export async function forkAndSend(repo: string, id: string, text: string): Promise<string> {
	const { session } = await live(repo, id);
	if (!session.claudeSession) throw new Error('This session has nothing to fork yet');
	const { sessionId } = await forkSession(session.claudeSession, { dir: session.cwd });
	const fork = await openClaudeSession(repo, session.cwd, sessionId, session);
	await send(repo, fork, text, true);
	return fork;
}

/**
 * The sessions in the worktrees, newest first: the app's, and Claude Code's own it hasn't
 * opened, a terminal's.
 */
export async function listSessions(repo: string, worktrees: string[]): Promise<SessionSummary[]> {
	const files = await readdir(sessionsDir(repo)).catch(() => []);
	const saved = await Promise.all(
		files
			.filter((f) => f.endsWith('.json'))
			.map((f) =>
				readFile(join(sessionsDir(repo), f), 'utf8').then(
					(text) => JSON.parse(text) as Session,
					() => null
				)
			)
	);
	const mine = saved
		.filter((s): s is Session => s !== null)
		.map((s): Session => sessions.get(s.id)?.session ?? { ...s, status: 'closed' });
	const theirs = (
		await Promise.all(
			worktrees.map((dir) =>
				// as the terminal's /resume lists them: not the headless runs of `claude -p` and the
				// SDK, the app's guides and questions among them. Its own coding sessions are in `mine`
				listClaudeSessions({ dir, includeWorktrees: false, includeProgrammatic: false }).then(
					(found) => found.map((s) => ({ ...s, dir })),
					() => []
				)
			)
		)
	).flat();
	const opened = new Set(mine.map((s) => s.claudeSession));
	return [
		...mine.map(
			({
				id,
				cwd,
				title,
				createdAt,
				status,
				items,
				syncedAt,
				open,
				doneAt,
				seenAt,
				tasks
			}): SessionSummary => ({
				id,
				cwd,
				title,
				status: shownStatus({ status, tasks } as Session),
				// an approval in a session that ended can't be answered anymore
				waiting: status !== 'closed' && items.some((i) => i.type === 'approval' && !i.decision),
				failed: !!items.findLast((i) => i.type === 'turn')?.error,
				// its last turn's end
				updatedAt: syncedAt ?? Date.parse(createdAt),
				open: open !== false,
				unread: !!doneAt && doneAt > (seenAt ?? 0)
			})
		),
		...theirs
			.filter((s) => !opened.has(s.sessionId))
			.map((s): SessionSummary => ({
				id: s.sessionId,
				cwd: s.dir,
				title: s.customTitle || s.summary,
				status: 'closed',
				waiting: false,
				updatedAt: s.lastModified,
				claude: true,
				open: false,
				unread: false
			}))
	].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createSession(
	repo: string,
	cwd: string,
	text: string,
	mode?: Mode,
	model?: string,
	effort?: Effort
) {
	const settings = await loadSettings();
	const session: Session = {
		id: randomUUID(),
		repo,
		cwd,
		title: firstLine(text).slice(0, 80) || 'New session',
		createdAt: new Date().toISOString(),
		mode: mode ?? settings.mode,
		model: model ?? settings.model,
		effort: effort ?? settings.effort,
		status: 'closed',
		open: true,
		items: [],
		cost: 0
	};
	sessions.set(session.id, fresh(session));
	await send(repo, session.id, text);
	return session.id;
}

/**
 * Sends a message, starting the session's process when it has none. Sent mid-turn, it's queued.
 * Not sent while another Claude Code may have the session open, unless `force`d: `busy` says
 * how long ago it wrote to it.
 */
export async function send(
	repo: string,
	id: string,
	text: string,
	force = false
): Promise<{ busy?: number }> {
	const entry = await live(repo, id);
	const { session } = entry;
	await catchUp(entry);
	const ago = entry.elsewhereAt ? Date.now() - entry.elsewhereAt : Infinity;
	if (!entry.query && ago < BUSY_MS && !force) return { busy: ago };
	entry.elsewhereAt = undefined;
	clearTimeout(entry.idle);
	const item: Extract<Item, { type: 'user' }> = {
		type: 'user',
		id: randomUUID(),
		text,
		at: new Date().toISOString(),
		// mid-turn it waits for the turn to end, shown as queued until Claude Code takes it up
		...(entry.query && session.status === 'running' && { queued: true as const })
	};
	session.items.push(item);
	// a new process says it's starting until Claude Code is up, and is sent what was queued
	// for the one before it
	if (!entry.query) await start(entry);
	else session.status = 'running';
	if (entry.query) deliver(entry, item);
	changed(entry);
	await save(session);
	return {};
}

/** A message to the process, by its id, so the turn that takes it up says so. */
function deliver(entry: Live, item: Extract<Item, { type: 'user' }>) {
	entry.pending.add(item.id);
	entry.inbox!.push({
		type: 'user',
		uuid: item.id,
		message: { role: 'user', content: item.text },
		parent_tool_use_id: null,
		origin: { kind: 'human' }
	} as SDKUserMessage);
}

/** Messages Claude Code took up: no longer queued, in the chat where their turn starts. */
function takenUp(entry: Live, ids: string[] | undefined) {
	for (const id of ids ?? []) {
		if (!entry.pending.delete(id)) continue;
		const items = entry.session.items;
		const at = items.findIndex((i) => i.type === 'user' && i.id === id);
		if (at < 0) continue;
		const [item] = items.splice(at, 1) as Extract<Item, { type: 'user' }>[];
		items.push(item.queued ? (({ queued: _, ...rest }) => rest)(item) : item);
	}
}

/** Running while its subagents work in the background too, its turn over or not. */
function shownStatus(session: Session): Session['status'] {
	return session.status === 'idle' && session.tasks?.length ? 'running' : session.status;
}

/** A session's Claude Code is working in the worktree: git leaves it alone meanwhile. */
export function busyIn(cwd: string): boolean {
	return [...sessions.values()].some(({ session }) => {
		const status = shownStatus(session);
		return session.cwd === cwd && (status === 'running' || status === 'starting');
	});
}

/** Puts the session in the sidebar, or takes it out, stopping its Claude Code. Nothing is deleted. */
export async function setOpen(repo: string, id: string, open: boolean) {
	const entry = await live(repo, id);
	entry.session.open = open;
	if (open) entry.session.seenAt = Date.now();
	else stop(entry);
	changed(entry);
	await save(entry.session);
}

/** It was looked at: what its last turn did isn't unread anymore. */
export async function markSeen(repo: string, id: string) {
	const entry = await live(repo, id);
	entry.session.seenAt = Date.now();
	await save(entry.session);
}

export async function interrupt(repo: string, id: string) {
	await (await live(repo, id)).query?.interrupt();
}

/** Stops one of its subagents, its end told to the session as any other's. */
export async function stopTask(repo: string, id: string, taskId: string) {
	const entry = await live(repo, id);
	if (!entry.session.tasks?.some((t) => t.id === taskId)) throw new Error('No such agent running');
	await entry.query?.stopTask(taskId);
}

/** Switches the running process's mode, or the one the next process starts in. */
export async function setMode(repo: string, id: string, mode: Mode) {
	const entry = await live(repo, id);
	entry.session.mode = mode;
	await entry.query?.setPermissionMode(mode);
	changed(entry);
	await save(entry.session);
}

export async function setModel(repo: string, id: string, model: string) {
	const entry = await live(repo, id);
	entry.session.model = model;
	await entry.query?.setModel(claudeModel(model));
	changed(entry);
	await save(entry.session);
}

export async function setEffort(repo: string, id: string, effort: Effort) {
	const entry = await live(repo, id);
	entry.session.effort = effort;
	// null goes back to the model's own default
	await entry.query?.applyFlagSettings({ effortLevel: effort === 'default' ? null : effort });
	changed(entry);
	await save(entry.session);
}

/** The model as Claude Code takes it, its own default left to it. */
const claudeModel = (model?: string) => (model === 'default' ? undefined : model);

// asked of Claude Code once, it starts without being sent anything to answer that
let models: Promise<ModelOption[]> | undefined;

/** The models the user's Claude Code offers, its default first. */
export function listModels(repo: string): Promise<ModelOption[]> {
	models ??= (async () => {
		const q = query({ prompt: inbox(), options: await baseOptions(repo, repo) });
		try {
			return (await q.supportedModels()).map((m) => ({
				value: m.value,
				// "Default (recommended)" says which it is in its description: "Opus 5.5 · Best for …"
				label: m.value === 'default' ? `Default · ${m.description.split(' · ')[0]}` : m.displayName,
				title: m.description,
				efforts: m.supportsEffort ? (m.supportedEffortLevels ?? []) : []
			}));
		} finally {
			q.close();
		}
	})().catch((error) => {
		models = undefined;
		throw error;
	});
	return models;
}

export async function decide(
	repo: string,
	id: string,
	approval: string,
	decision: 'allow' | 'always' | 'deny'
) {
	const resolve = (await live(repo, id)).approvals.get(approval);
	if (!resolve) throw new Error('That request was already answered');
	resolve(decision);
}

/** The session now, then again each time it changes, a burst of changes sent as one. */
export async function* watchSession(repo: string, id: string, signal: AbortSignal) {
	const entry = await live(repo, id);
	// opened again: what a terminal wrote meanwhile, while this one was idle in memory
	await catchUp(entry);
	let dirty = true;
	let wake: (() => void) | undefined;
	const listener = () => {
		dirty = true;
		wake?.();
	};
	entry.listeners.add(listener);
	signal.addEventListener('abort', listener);
	try {
		while (!signal.aborted) {
			if (!dirty) await new Promise<void>((resolve) => (wake = resolve));
			await new Promise((resolve) => setTimeout(resolve, 50));
			dirty = false;
			yield structuredClone(entry.session);
		}
	} finally {
		entry.listeners.delete(listener);
		signal.removeEventListener('abort', listener);
	}
}

/** Messages to the CLI as they're sent, open until the session closes. */
type Inbox = ReturnType<typeof inbox>;
function inbox() {
	const queue: SDKUserMessage[] = [];
	let wake: (() => void) | undefined;
	let closed = false;
	return {
		push(message: SDKUserMessage) {
			queue.push(message);
			wake?.();
		},
		close() {
			closed = true;
			wake?.();
		},
		async *[Symbol.asyncIterator]() {
			for (;;) {
				while (queue.length) yield queue.shift()!;
				if (closed) return;
				await new Promise<void>((resolve) => (wake = resolve));
			}
		}
	};
}

/** How Claude Code is run in `cwd`: the user's own, inside the wrapper when there is one. */
async function baseOptions(cwd: string, repo: string): Promise<Options> {
	const settings = await loadSettings();
	const wrapper = wrapperArgs(settings.wrapper, cwd, repo);
	return {
		cwd,
		systemPrompt: { type: 'preset', preset: 'claude_code' },
		settingSources: ['user', 'project', 'local'],
		// the user's own install and sign-in, never the SDK's bundled copy
		pathToClaudeCodeExecutable: env.CLAUDE_BIN || 'claude',
		env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'sloppy-diff' },
		...(settings.sandbox && { sandbox: { enabled: true, autoAllowBashIfSandboxed: true } }),
		spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
			const [bin, ...pre] = [...wrapper, command];
			log('agent', `starting ${[bin, ...pre].join(' ')} in ${cwd}`);
			const child = spawn(bin, [...pre, ...args], { cwd, env, signal, stdio: 'pipe' });
			child.stderr.on('data', (data) => log('agent', String(data).trim()));
			return child;
		}
	};
}

async function start(entry: Live) {
	const { session } = entry;
	const messages = inbox();
	const options: Options = {
		...(await baseOptions(session.cwd, session.repo)),
		resume: session.claudeSession,
		permissionMode: session.mode,
		model: claudeModel(session.model),
		...(session.effort && session.effort !== 'default' && { effort: session.effort }),
		// lets the mode be switched to it later
		allowDangerouslySkipPermissions: true,
		includePartialMessages: true,
		// a line on what each subagent's on, every 30s or so, cheap off its cache
		agentProgressSummaries: true,
		// the questions tool needs a form of its own, asked in the chat instead
		disallowedTools: ['AskUserQuestion'],
		canUseTool: approve(entry)
	};
	entry.inbox = messages;
	entry.query = query({ prompt: messages, options });
	// a resumed session's Claude Code reports what it had spent before too
	entry.spent = session.claudeSession ? (session.costTotal ?? 0) : 0;
	session.status = 'starting';
	// a process's tasks are its own, and it says nothing of them as it starts
	session.tasks = [];
	// what was queued for a process that stopped before taking it up
	for (const item of session.items) if (item.type === 'user' && item.queued) deliver(entry, item);
	void pump(entry, entry.query);
}

/**
 * Stops the process once it's been idle a while, rather than at once after a restart. Not while
 * a subagent works on: its end is told to the session, a turn of its own.
 */
function rest(entry: Live) {
	const { session } = entry;
	// running, its timer is the one for a queued message's turn
	if (session.status !== 'idle' || entry.pending.size) return;
	clearTimeout(entry.idle);
	if (session.tasks?.length) return;
	entry.idle = setTimeout(
		() => session.status === 'idle' && !entry.pending.size && !session.tasks?.length && stop(entry),
		entry.restart ? 0 : IDLE_MS
	);
}

type TaskMessage =
	| SDKTaskStartedMessage
	| SDKTaskProgressMessage
	| SDKTaskUpdatedMessage
	| SDKTaskNotificationMessage;

/**
 * Whether a task is a subagent, or a workflow of them. Background shells and monitors are tasks
 * too, but a dev server can run for ever: they'd keep the session busy and git waiting on it.
 * Nor the main session moved to the background, or housekeeping that isn't activity.
 */
const isAgent = (task: { task_type?: string; subagent_type?: string; ambient?: boolean }) =>
	!task.ambient &&
	task.subagent_type !== 'main-session' &&
	(task.task_type === 'local_agent' ||
		task.task_type === 'local_workflow' ||
		(!task.task_type && !!task.subagent_type));

/** The session's subagents from their events: started, what they're on, moved back, done. */
export function followTask(entry: Live, message: TaskMessage) {
	const { session } = entry;
	const tasks = (session.tasks ??= []);
	const task = tasks.find((t) => t.id === message.task_id);
	if (message.subtype === 'task_started') {
		if (task || !isAgent(message) || message.skip_transcript) return;
		tasks.push({
			id: message.task_id,
			toolUseId: message.tool_use_id,
			description: message.description,
			background: !!message.is_backgrounded
		});
	} else if (!task) {
		return;
	} else if (message.subtype === 'task_progress') {
		task.doing = message.summary || message.last_tool_name || task.doing;
	} else if (message.subtype === 'task_updated') {
		const { status, is_backgrounded, description } = message.patch;
		if (is_backgrounded !== undefined) task.background = is_backgrounded;
		if (description) task.description = description;
		if (status && status !== 'running' && status !== 'pending') finished(entry, task);
	} else {
		finished(entry, task);
	}
}

function finished(entry: Live, task: Task) {
	entry.session.tasks = entry.session.tasks?.filter((t) => t !== task);
	rest(entry);
}

/**
 * The background ones as Claude Code has them, the set it sends whole on each change: one whose
 * end was missed doesn't look busy for ever.
 */
export function followBackground(entry: Live, message: SDKBackgroundTasksChangedMessage) {
	const { session } = entry;
	const live = new Map(message.tasks.filter(isAgent).map((t) => [t.task_id, t]));
	const tasks = (session.tasks ?? []).filter((t) => !t.background || live.has(t.id));
	for (const [id, t] of live) {
		const known = tasks.find((k) => k.id === id);
		if (known) known.background = true;
		else tasks.push({ id, description: t.description, background: true });
	}
	session.tasks = tasks;
	rest(entry);
}

/** Reads the process's messages into the session until it ends. */
async function pump(entry: Live, q: Query) {
	const { session } = entry;
	/** the text or thinking block being streamed */
	let open: Extract<Item, { type: 'text' | 'thinking' }> | null = null;
	const push = (item: Item) => session.items.push(item);
	try {
		for await (const message of q as AsyncIterable<SDKMessage>) {
			entry.heardAt = Date.now();
			// a subagent's own steps, its result comes back as the Agent tool's output
			if ('parent_tool_use_id' in message && message.parent_tool_use_id) continue;
			// a queued message's turn, started by Claude Code without a send
			if (
				session.status === 'idle' &&
				(message.type === 'stream_event' || message.type === 'assistant')
			) {
				session.status = 'running';
			}
			// the messages a turn took up, said on whichever message comes first, a system one too
			const said = message as { user_message_uuid?: string; user_message_uuids?: string[] };
			takenUp(
				entry,
				said.user_message_uuids ?? (said.user_message_uuid ? [said.user_message_uuid] : [])
			);
			if (message.type === 'system' && message.subtype === 'init') {
				session.claudeSession = message.session_id;
				if (session.status === 'starting') session.status = 'running';
			} else if (message.type === 'system' && message.subtype === 'compact_boundary') {
				push({ type: 'notice', text: 'Compacted the conversation' });
			} else if (message.type === 'system' && message.subtype.startsWith('task_')) {
				followTask(entry, message as TaskMessage);
			} else if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
				followBackground(entry, message as SDKBackgroundTasksChangedMessage);
			} else if (message.type === 'stream_event') {
				const event = message.event;
				if (event.type === 'content_block_start') {
					const kind = event.content_block.type;
					if (kind === 'text' || kind === 'thinking') {
						const block = { type: kind, text: '' };
						open = block;
						push(block);
					}
				} else if (event.type === 'content_block_delta' && open) {
					if (event.delta.type === 'text_delta') open.text += event.delta.text;
					else if (event.delta.type === 'thinking_delta') open.text += event.delta.thinking;
				} else if (event.type === 'content_block_stop') open = null;
			} else if (message.type === 'assistant') {
				// text and thinking came streamed, the tool calls come whole here
				for (const block of message.message.content) {
					if (block.type !== 'tool_use') continue;
					const input = (block.input ?? {}) as Record<string, unknown>;
					push({
						type: 'tool',
						id: block.id,
						name: block.name,
						...describe(block.name, input, session.cwd),
						done: false
					});
				}
				const usage = message.message.usage;
				if (usage) {
					session.contextTokens =
						usage.input_tokens +
						(usage.cache_read_input_tokens ?? 0) +
						(usage.cache_creation_input_tokens ?? 0) +
						usage.output_tokens;
				}
			} else if (message.type === 'user' && Array.isArray(message.message.content)) {
				for (const block of message.message.content) {
					if (block.type !== 'tool_result') continue;
					const tool = session.items.findLast(
						(i): i is Extract<Item, { type: 'tool' }> =>
							i.type === 'tool' && i.id === block.tool_use_id
					);
					if (!tool) continue;
					tool.done = true;
					tool.failed = block.is_error ?? false;
					tool.output = cut(resultText(block.content), 6000);
				}
			} else if (message.type === 'result') {
				// a running total, from what a resumed session had spent before. One below it is a
				// count started over, a /clear
				const total = message.total_cost_usd;
				const cost = total >= entry.spent ? total - entry.spent : total;
				entry.spent = session.costTotal = total;
				session.cost += cost;
				for (const item of session.items) if (item.type === 'tool') item.done = true;
				push({
					type: 'turn',
					durationMs: message.duration_ms,
					cost,
					error:
						message.subtype === 'success'
							? undefined
							: message.subtype === 'error_during_execution'
								? 'Stopped'
								: message.subtype
				});
				session.syncedAt = session.doneAt = Date.now();
				clearTimeout(entry.idle);
				// a message queued mid-turn gets a turn of its own right after this one. Should
				// Claude Code never say it took one up, it isn't left looking busy for ever
				if (entry.pending.size) {
					session.status = 'running';
					entry.idle = setTimeout(() => {
						if (!entry.pending.size || Date.now() - (entry.heardAt ?? 0) < 25_000) return;
						takenUp(entry, [...entry.pending]);
						session.status = 'idle';
						rest(entry);
						changed(entry);
					}, 30_000);
				} else {
					session.status = 'idle';
					rest(entry);
				}
				await save(session);
			}
			changed(entry);
		}
	} catch (error) {
		push({
			type: 'notice',
			text: `Claude Code stopped: ${error instanceof Error ? error.message : error}`
		});
	} finally {
		if (entry.query === q) ended(entry);
		changed(entry);
		await save(session).catch(() => {});
	}
}

/** Asks the page before a tool runs, when the permission mode leaves it to the user. */
function approve(entry: Live): CanUseTool {
	return async (name, input, { signal, suggestions }) => {
		const item: Extract<Item, { type: 'approval' }> = {
			type: 'approval',
			id: randomUUID(),
			tool: name,
			...describe(name, input, entry.session.cwd),
			...(name === 'ExitPlanMode' && { plan: String(input.plan ?? '') })
		};
		entry.session.items.push(item);
		changed(entry);
		await save(entry.session);
		const decision = await new Promise<'allow' | 'always' | 'deny'>((resolve) => {
			entry.approvals.set(item.id, resolve);
			signal.addEventListener('abort', () => resolve('deny'), { once: true });
		});
		entry.approvals.delete(item.id);
		item.decision = decision;
		changed(entry);
		await save(entry.session);
		if (decision === 'deny') return { behavior: 'deny', message: 'The user said no.' };
		return {
			behavior: 'allow',
			updatedInput: input,
			...(decision === 'always' && suggestions && { updatedPermissions: suggestions })
		};
	};
}

/** A tool call in a line, and what it was given as it reads best. */
export function describe(
	name: string,
	input: Record<string, unknown>,
	cwd: string
): { title: string; detail?: string } {
	const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
	const path = (key: string) => (str(key) ? relative(cwd, str(key)) || '.' : '');
	switch (name) {
		case 'Bash': {
			const command = str('command');
			return { title: firstLine(command), detail: command.includes('\n') ? command : undefined };
		}
		case 'Read':
			return { title: path('file_path') };
		case 'Write':
			return { title: path('file_path'), detail: cut(str('content'), 4000) };
		case 'Edit': {
			const lines = (text: string, sign: string) =>
				text
					.split('\n')
					.map((l) => sign + l)
					.join('\n');
			return {
				title: path('file_path'),
				detail: cut(`${lines(str('old_string'), '-')}\n${lines(str('new_string'), '+')}`, 4000)
			};
		}
		case 'Grep':
		case 'Glob':
			return { title: str('pattern') + (str('path') ? ` in ${path('path')}` : '') };
		case 'WebFetch':
			return { title: str('url') };
		case 'WebSearch':
			return { title: str('query') };
		case 'Agent':
		case 'Task':
			return { title: str('description'), detail: cut(str('prompt'), 4000) };
		case 'TodoWrite': {
			const todos = Array.isArray(input.todos)
				? (input.todos as { content: string; status: string }[])
				: [];
			const mark = (s: string) => (s === 'completed' ? '☑' : s === 'in_progress' ? '◐' : '☐');
			return {
				title: `${todos.filter((t) => t.status === 'completed').length} of ${todos.length} done`,
				detail: todos.map((t) => `${mark(t.status)} ${t.content}`).join('\n')
			};
		}
		case 'ExitPlanMode':
			return { title: 'Ready to start on the plan' };
		default:
			return { title: '', detail: cut(JSON.stringify(input, null, 2), 4000) };
	}
}

function resultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((c) => (c && typeof c === 'object' && 'text' in c ? String(c.text) : ''))
		.join('\n');
}

const cut = (text: string, max: number) =>
	text.length <= max ? text : `${text.slice(0, max)}\n… ${text.length - max} more characters`;
