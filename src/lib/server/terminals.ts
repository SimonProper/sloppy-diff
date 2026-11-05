import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, type IPty } from 'node-pty';
import type { Scripts, TerminalEvent, TerminalInfo } from '$lib/agents/types';
import { repoDir } from './guides';

/** A shell in a worktree, Conductor's and t3code's terminal, and who's watching it. */
interface Live extends TerminalInfo {
	pty: IPty;
	/** what it printed, the last of it, for a page that opens it later */
	out: string;
	watchers: Set<(event: TerminalEvent) => void>;
}

// ponytail: the last million characters, cut wherever that falls, an escape sequence it
// splits garbles the top of the replay
const SCROLLBACK = 1_000_000;

// kept on globalThis so a dev server module reload doesn't orphan the shells, they go
// with the server itself
const store = globalThis as { __terminals?: Map<string, Live> };
const terminals = (store.__terminals ??= new Map<string, Live>());

/**
 * A login shell in `cwd`, as the user's own terminal starts it, `command` typed into it
 * as if by hand: ^C stops it and leaves the shell, ↑ has it again.
 */
export function openTerminal(cwd: string, repo: string, title: string, command = ''): TerminalInfo {
	const pty = spawn(process.env.SHELL || '/bin/zsh', ['-l'], {
		name: 'xterm-256color',
		cols: 80,
		rows: 24,
		cwd,
		env: {
			...outside(),
			TERM: 'xterm-256color',
			COLORTERM: 'truecolor',
			// Conductor's CONDUCTOR_ROOT_PATH and CONDUCTOR_WORKSPACE_PATH, for a script to
			// copy an .env from the main checkout
			SLOPPY_ROOT: repo,
			SLOPPY_WORKTREE: cwd
		}
	});
	const term: Live = { id: randomUUID(), cwd, title, pty, out: '', watchers: new Set() };
	terminals.set(term.id, term);
	pty.onData((data) => {
		term.out = (term.out + data).slice(-SCROLLBACK);
		for (const watch of term.watchers) watch({ data });
	});
	pty.onExit(({ exitCode }) => {
		term.exited = exitCode;
		for (const watch of term.watchers) watch({ exit: exitCode });
		term.watchers.clear();
	});
	if (command.trim()) pty.write(`${command.trim()}\r`);
	return info(term);
}

/**
 * The server's environment without the terminal it was started in: `pnpm dev` run in a
 * Ghostty or herdr pane hands down their variables, and a shell that sees them sets itself
 * up for Ghostty, or reports to herdr as that pane.
 */
function outside() {
	const env = { ...process.env };
	for (const key of Object.keys(env))
		if (/^(TERM_PROGRAM|TERMINFO|GHOSTTY_|HERDR_|TMUX|ITERM_|KITTY_|WEZTERM_)/.test(key))
			delete env[key];
	return env;
}

const info = ({ id, cwd, title, exited }: Live): TerminalInfo => ({ id, cwd, title, exited });

/** The worktree's terminals, oldest first. */
export const listTerminals = (cwd: string) =>
	[...terminals.values()].filter((t) => t.cwd === cwd).map(info);

function get(id: string) {
	const term = terminals.get(id);
	if (!term) throw new Error('That terminal is closed');
	return term;
}

export function writeTerminal(id: string, data: string) {
	const term = get(id);
	if (term.exited === undefined) term.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number) {
	const term = get(id);
	if (term.exited === undefined) term.pty.resize(Math.max(2, cols), Math.max(1, rows));
}

/** Hangs up on the shell, which takes what it runs with it. */
export function closeTerminal(id: string) {
	const term = get(id);
	if (term.exited === undefined) term.pty.kill();
	terminals.delete(id);
}

/** What it printed so far, then what it prints, until it exits or `watch` is unsubscribed. */
export function watchTerminal(id: string, watch: (event: TerminalEvent) => void) {
	const term = get(id);
	watch({ data: term.out });
	if (term.exited !== undefined) watch({ exit: term.exited });
	else term.watchers.add(watch);
	return () => void term.watchers.delete(watch);
}

// ---- the repo's scripts

const scriptsPath = (repo: string) => join(repoDir(repo), 'worktree-scripts.json');

export async function loadScripts(repo: string): Promise<Scripts> {
	const saved = await readFile(scriptsPath(repo), 'utf8').then(JSON.parse, () => ({}));
	return { setup: '', run: '', ...saved };
}

export async function saveScripts(repo: string, scripts: Scripts) {
	await mkdir(repoDir(repo), { recursive: true });
	await writeFile(scriptsPath(repo), JSON.stringify(scripts, null, '\t'));
}
