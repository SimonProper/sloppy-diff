/** How the agent asks before it acts, Claude Code's permission modes. */
export type Mode = 'default' | 'acceptEdits' | 'auto' | 'plan' | 'bypassPermissions';

export const MODES: { value: Mode; label: string; title: string }[] = [
	{ value: 'default', label: 'Ask', title: 'Asks before edits and commands' },
	{
		value: 'acceptEdits',
		label: 'Accept edits',
		title: 'Edits files without asking, asks for commands'
	},
	{ value: 'auto', label: 'Auto', title: 'A classifier approves what is safe, asks for the rest' },
	{ value: 'plan', label: 'Plan', title: 'Reads and plans, changes nothing' },
	{ value: 'bypassPermissions', label: 'Bypass', title: 'Never asks. Only inside a sandbox' }
];

/** How hard the model thinks, Claude Code's effort levels, `default` for the model's own. */
export type Effort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORTS: { value: Effort; label: string; title: string }[] = [
	{ value: 'default', label: 'Default effort', title: "The model's own default" },
	{ value: 'low', label: 'Low', title: 'Fastest, thinks least' },
	{ value: 'medium', label: 'Medium', title: 'Thinks some' },
	{ value: 'high', label: 'High', title: 'Thinks more' },
	{ value: 'xhigh', label: 'Extra high', title: 'Thinks a lot' },
	{ value: 'max', label: 'Max', title: 'Thinks most, for this session only' }
];

/**
 * The mode after this one for ⇧⇥, as Claude Code cycles them: never on to Bypass, a mode that
 * asks nothing is picked on purpose.
 */
export function nextMode(mode: Mode): Mode {
	const cycle = MODES.filter((m) => m.value !== 'bypassPermissions');
	return cycle[(cycle.findIndex((m) => m.value === mode) + 1) % cycle.length].value;
}

/** ⇧⇥ typed in a field's text: what a composer cycles the mode on, a list's outdent aside. */
export const cyclesMode = (event: KeyboardEvent) =>
	event.key === 'Tab' &&
	event.shiftKey &&
	!event.defaultPrevented &&
	!!(event.target as Element | null)?.closest?.('.ProseMirror');

/** One thing in a session, in the order it happened. */
export type Item =
	/** `queued`: sent while it worked, not taken up by Claude Code yet, sent again if it stops first */
	| { type: 'user'; id: string; text: string; at: string; queued?: true }
	| { type: 'thinking'; text: string }
	| { type: 'text'; text: string }
	| {
			type: 'tool';
			id: string;
			name: string;
			/** one line: the command, the file, the pattern */
			title: string;
			/** what the call was given, as it reads best: a diff for an edit, the command */
			detail?: string;
			output?: string;
			failed?: boolean;
			done: boolean;
	  }
	| {
			type: 'approval';
			id: string;
			tool: string;
			title: string;
			detail?: string;
			/** the plan, for ExitPlanMode, in markdown */
			plan?: string;
			decision?: 'allow' | 'always' | 'deny';
	  }
	/** a turn ended: what it took, or why it stopped */
	| { type: 'turn'; durationMs?: number; cost?: number; error?: string }
	| { type: 'notice'; text: string };

export interface Session {
	id: string;
	/** the main checkout, sessions are kept with its guides */
	repo: string;
	/** the worktree the agent works in */
	cwd: string;
	title: string;
	createdAt: string;
	/** Claude Code's own session, resumed after the process went away */
	claudeSession?: string;
	/** when the items last matched Claude Code's transcript of the session, in ms */
	syncedAt?: number;
	/** in the sidebar: opened, or started, and not closed since. Saved before this, it was */
	open?: boolean;
	/** when its last turn ended, and when it was last looked at: unread while the one's later */
	doneAt?: number;
	seenAt?: number;
	mode: Mode;
	/** a model Claude Code offers, `default` for its own default */
	model?: string;
	effort?: Effort;
	/** idle: a process waiting for the next message, closed: no process */
	status: 'closed' | 'starting' | 'idle' | 'running';
	items: Item[];
	cost: number;
	/** Claude Code's running total for the session, a resumed process carries on from it */
	costTotal?: number;
	contextTokens?: number;
	/** its subagents while they run, gone with the process */
	tasks?: Task[];
}

/** A subagent the session's Claude Code started, while it runs. */
export interface Task {
	id: string;
	/** the Agent call that started it, its step in the chat */
	toolUseId?: string;
	description: string;
	/** the turn went on without waiting for it */
	background: boolean;
	/** what it's on: its progress summary, else the tool it last used */
	doing?: string;
}

export type SessionSummary = Pick<Session, 'id' | 'cwd' | 'title' | 'status'> & {
	/** an approval is waiting */
	waiting: boolean;
	/** when it last changed, in ms */
	updatedAt: number;
	/** only in Claude Code so far, e.g. from a terminal: `id` is Claude Code's */
	claude?: true;
	/** in the sidebar, see Session.open */
	open: boolean;
	/** a turn ended since it was looked at */
	unread: boolean;
	/** its last turn stopped or failed */
	failed?: boolean;
};

export interface Worktree {
	path: string;
	branch: string | null;
	head: string;
	main: boolean;
	sessions: SessionSummary[];
}

/** Where a worktree stands against its upstream and the base, what it has uncommitted. */
export interface Sync {
	/** commits it's ahead of and behind its upstream, without one neither */
	ahead?: number;
	behind?: number;
	/** the remote's default branch, `origin/main`, and how far from it the worktree is */
	base?: string;
	behindBase?: number;
	aheadBase?: number;
	/** lines its uncommitted changes add and remove */
	added: number;
	removed: number;
	/** anything uncommitted, untracked files included */
	dirty: boolean;
	/** git stopped in the middle of one, on conflicts or otherwise */
	operation?: Operation;
	/** the files in conflict are an autostash that didn't go back cleanly, after a pull or rebase */
	stashConflict?: true;
	/** files in conflict */
	conflicts?: string[];
}

export type Operation = 'rebase' | 'merge' | 'cherry-pick' | 'revert';

export type WorktreeStatus = Worktree & Sync;

/** The repo's last fetch. */
export interface FetchState {
	at?: number;
	/** why the last one failed, when it did */
	error?: string;
	fetching: boolean;
}

export interface AgentSettings {
	/**
	 * A command the CLI runs inside, `{worktree}` and `{repo}` filled in, e.g.
	 * `nono run --allow {worktree} --allow {repo} --`. Empty runs it as it is.
	 */
	wrapper: string;
	/** Claude Code's own sandbox for its commands */
	sandbox: boolean;
	mode: Mode;
	/** a model Claude Code offers, `default` for its own default */
	model: string;
	effort: Effort;
	/** pull the main checkout after each fetch, when it's clean and has nothing of its own */
	autoPull: boolean;
}

/** A model to pick, as Claude Code lists them. */
export interface ModelOption {
	value: string;
	label: string;
	title?: string;
	/** the effort levels it takes, none when it has no effort setting */
	efforts: Effort[];
}

/** A shell open in a worktree. */
export interface TerminalInfo {
	id: string;
	cwd: string;
	/** Terminal, Setup, Run */
	title: string;
	/** its shell's exit code, once it's gone */
	exited?: number;
}

/** What a terminal's page is sent: what it printed, or that it's gone. */
export type TerminalEvent = { data: string } | { exit: number };

/** The repo's commands for its worktrees, Conductor's setup and run scripts. */
export interface Scripts {
	/** typed into a terminal in each worktree the app makes, `pnpm install` */
	setup: string;
	/** typed into one by the Run button, `pnpm dev` */
	run: string;
}
