/** Which side of a split diff a selection was made on. */
export type Side = 'old' | 'new';

/** A span of lines in one hunk, the lines a question is about. */
export interface LineSpan {
	hunk: string;
	/** first and last selected line, as indexes into the hunk's lines */
	start: number;
	end: number;
	/** split layout: only this side's lines of the span. Unified selects every line in it */
	side?: Side;
}

/** Where a thread sits in the diff. Hunk ids hash the content, so it stays put until the code changes. */
export interface Anchor extends LineSpan {
	path: string;
	/** "line 12", "lines 12–15", on the new side where the lines have numbers there */
	label: string;
	/** the selected lines as they read when asked, for a thread whose code has changed since */
	code: string;
}

/** Something Claude did on the way to an answer. */
export type Step =
	| { type: 'thinking'; text: string }
	| { type: 'tool'; text: string }
	/** what Claude said before carrying on, e.g. before looking at a file */
	| { type: 'text'; text: string };

export interface Message {
	role: 'user' | 'assistant';
	/** the question, or the answer in markdown */
	text: string;
	createdAt: string;
	/** rendered answer, filled in when the thread is loaded */
	html?: string;
	/** assistant: thinking and tool calls, in order */
	steps?: Step[];
	thinkingTokens?: number;
	/** assistant: how long Claude thought, the tool calls and the answer not counted */
	thinkingMs?: number;
	/** assistant: what this answer cost, in USD */
	cost?: number;
	durationMs?: number;
	model?: string;
	/** assistant: the answer failed or was cancelled */
	error?: string;
}

export interface Thread {
	id: string;
	anchor: Anchor;
	messages: Message[];
	createdAt: string;
	/** the Claude Code session, resumed for follow-ups */
	sessionId?: string;
	/** what the session has cost so far, claude reports a running total */
	sessionCost?: number;
	/** set when loaded: the lines it's about aren't in the diff anymore */
	outdated?: boolean;
}

/** Which diff a thread belongs to: a commit range, or the uncommitted changes. */
export type Scope = 'worktree' | `${string}..${string}`;

/** What happens while Claude answers, folded into an Answer for the page. */
export type AskEvent =
	| { type: 'status'; text: string }
	| { type: 'thinking'; text: string }
	| { type: 'tool'; text: string }
	| { type: 'text'; text: string }
	| { type: 'thinking_tokens'; tokens: number }
	| { type: 'done'; thread: Thread }
	| { type: 'error'; message: string };
