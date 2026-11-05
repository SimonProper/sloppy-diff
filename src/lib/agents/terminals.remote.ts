import { command, query } from '$app/server';
import { checkWorktree, mainCheckout } from '$lib/server/agents';
import { badRequestOnError } from '$lib/server/requests';
import {
	closeTerminal,
	listTerminals,
	loadScripts,
	openTerminal,
	resizeTerminal,
	saveScripts,
	writeTerminal
} from '$lib/server/terminals';
import type { Scripts } from './types';

type Where = { repo: string; cwd: string };

// refreshed as the panel asks for it, by repo and cwd alone: a query's key is its whole argument
const listed = ({ repo, cwd }: Where) => getTerminals({ repo, cwd }).refresh();

async function worktree({ repo, cwd }: Where) {
	const main = await mainCheckout(repo);
	return { main, path: await checkWorktree(main, cwd) };
}

/** The worktree's terminals, oldest first. */
export const getTerminals = query('unchecked', (where: Where) =>
	badRequestOnError(async () => listTerminals((await worktree(where)).path))
);

/** A shell in the worktree, the repo's run script typed into it when it's to `run`. */
export const newTerminal = command('unchecked', (where: Where & { run?: boolean }) =>
	badRequestOnError(async () => {
		const { main, path } = await worktree(where);
		const run = where.run ? (await loadScripts(main)).run : '';
		if (where.run && !run.trim()) throw new Error('This repo has no run script, see Settings');
		const term = openTerminal(path, main, where.run ? 'Run' : 'Terminal', run);
		await listed(where);
		return term;
	})
);

export const closeTerminalIn = command('unchecked', (where: Where & { id: string }) =>
	badRequestOnError(async () => {
		closeTerminal(String(where.id));
		await listed(where);
	})
);

export const typeInTerminal = command('unchecked', ({ id, data }: { id: string; data: string }) =>
	badRequestOnError(async () => writeTerminal(String(id), String(data)))
);

export const sizeTerminal = command(
	'unchecked',
	({ id, cols, rows }: { id: string; cols: number; rows: number }) =>
		badRequestOnError(async () => {
			if (!Number.isInteger(cols) || !Number.isInteger(rows)) throw new Error('Not a size');
			resizeTerminal(String(id), cols, rows);
		})
);

export const getScripts = query('unchecked', (repo: string) =>
	badRequestOnError(async () => loadScripts(await mainCheckout(repo)))
);

export const setScripts = command('unchecked', ({ repo, setup, run }: Scripts & { repo: string }) =>
	badRequestOnError(async () => {
		const scripts = { setup: String(setup ?? '').trim(), run: String(run ?? '').trim() };
		await saveScripts(await mainCheckout(repo), scripts);
		getScripts(repo).set(scripts);
	})
);
