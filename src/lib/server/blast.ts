import {
	cp,
	mkdir,
	readdir,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { env } from '$env/dynamic/private';
import { spanLines } from '$lib/ask/span';
import { linesOf, type Anchor } from '$lib/ask/types';
import { findHunk } from '$lib/diff/hunks';
import type { DiffFile } from '$lib/diff/types';
import { git } from './git';
import { repoDir } from './guides';
import { startLsp } from './lsp';

/**
 * The blast radius of selected lines: where what they declare is used, found by the
 * language's own compiler through its language server, at the change's head commit.
 * Claude reads that list and judges each use, this only gathers it.
 */

/** how long a language server may index before its answers are taken as they are */
const INDEX_TIMEOUT_MS = 10 * 60_000;
/** how long it has to start reporting that work */
const INDEX_GRACE_MS = 1500;
/** one question to the server, a whole-repo search included */
const REQUEST_TIMEOUT_MS = 2 * 60_000;
/** declarations looked up from one selection, a selection across a whole class has many */
const MAX_SYMBOLS = 5;
/** uses listed for each, and the callers whose own callers are looked up */
const MAX_REFERENCES = 80;
const MAX_CALLERS = 20;
/** and of each one's own callers, the ones named */
const MAX_CALLERS_UP = 8;
/** commits looked back through for files that change together with the selected one */
const CO_CHANGE_COMMITS = 100;
/** a commit touching more files than this is a sweep, not a sign two files belong together */
const CO_CHANGE_MAX_FILES = 40;

export type Server = 'typescript' | 'svelte' | 'clangd';

const SERVERS: [RegExp, Server][] = [
	[/\.[cm]?[jt]sx?$/, 'typescript'],
	[/\.svelte$/, 'svelte'],
	[/\.(c|cc|cpp|cxx|c\+\+|h|hh|hpp|hxx|h\+\+|ipp|inl|tpp|m|mm|cu)$/i, 'clangd']
];

const NAMES: Record<Server, string> = {
	typescript: 'the TypeScript language server',
	svelte: 'the Svelte language server',
	clangd: 'clangd'
};

export const serverFor = (path: string): Server | null =>
	SERVERS.find(([pattern]) => pattern.test(path))?.[1] ?? null;

function languageId(path: string): string {
	const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
	if (/^[cm]?ts$/.test(ext)) return 'typescript';
	if (ext === 'tsx') return 'typescriptreact';
	if (/^[cm]?js$/.test(ext)) return 'javascript';
	if (ext === 'jsx') return 'javascriptreact';
	if (ext === 'svelte') return 'svelte';
	if (ext === 'c') return 'c';
	if (ext === 'm') return 'objective-c';
	if (ext === 'mm') return 'objective-cpp';
	return 'cpp';
}

/** What happens on the way, for the page: progress, and the steps worth keeping. */
export interface Reporter {
	status(text: string): void;
	/** `detail`: what the step found, for the reader to check the analysis by */
	step(text: string, detail?: string): void;
}

const seconds = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)}s`;

/**
 * What a reviewer needs to judge the blast radius of the anchor's lines, as prompt
 * text: their declarations' uses and callers, and the files that change with theirs.
 */
export async function blastRadius(
	source: { root: string; from: string; to: string },
	/** the repo at `to`, held with `holdCheckout` */
	dir: string,
	anchor: Anchor,
	files: DiffFile[],
	report: Reporter,
	/** stops the analysis and its language server */
	signal: AbortSignal
): Promise<string> {
	const { root, to } = source;
	const parts: string[] = [];
	const [statics, together] = await Promise.all([
		locked(root, () => uses(source, dir, anchor, files, report, signal)).catch((error: Error) => {
			report.step("The static analysis couldn't run", error.message);
			return `The static analysis couldn't run: ${error.message}. Search for the uses yourself.`;
		}),
		coChange(root, to, anchor.path, files, report).catch(() => '')
	]);
	parts.push(statics);
	if (together) parts.push(together);
	return parts.join('\n\n');
}

async function uses(
	{ root, to }: { root: string; to: string },
	dir: string,
	anchor: Anchor,
	files: DiffFile[],
	report: Reporter,
	signal: AbortSignal
): Promise<string> {
	/** what Claude is told when nothing could be looked up, shown on the way too */
	const nothing = (why: string, then = 'Search for the uses yourself.') => {
		report.step('Nothing looked up', why);
		return `${why} ${then}`;
	};
	const server = serverFor(anchor.path);
	if (!server) return nothing(`There's no language server for ${anchor.path} here.`);
	const span = linesOf(anchor);
	const found = span && findHunk(files, span.hunk);
	if (!found) return nothing("The selected lines aren't in the diff anymore.");
	const selected = spanLines(found.hunk, span);
	const lines = selected.map((l) => l.new).filter((n): n is number => n !== null);
	if (lines.length === 0) {
		return nothing(
			'The selected lines were all removed, so there is nothing at the head commit to look up.',
			'Search for what still uses them yourself.'
		);
	}

	const launch = await launchFor(server, root, dir);
	if ('missing' in launch) return nothing(launch.missing);

	// stopped while another analysis of the repo ran
	signal.throwIfAborted();
	let since = Date.now();
	report.status(`Starting ${NAMES[server]}`);
	const lsp = startLsp({
		command: launch.command,
		args: launch.args,
		cwd: dir,
		root: dir,
		onProgress: ({ title, message, percentage }) =>
			report.status(
				[title || 'Working', message ?? (percentage === undefined ? '' : `${percentage}%`)]
					.filter(Boolean)
					.join(' ')
			)
	});
	const kill = () => lsp.child.kill();
	signal.addEventListener('abort', kill, { once: true });
	try {
		// once one question goes unanswered the server is busy with it, the rest would wait too
		let stalled: Late | undefined;
		const ask = <T>(method: string, params: unknown) =>
			stalled
				? Promise.reject(stalled)
				: within(lsp.request<T>(method, params)).catch((error: Error) => {
						if (error instanceof Late) stalled = error;
						throw error;
					});
		await ask('initialize', {
			processId: process.pid,
			rootUri: pathToFileURL(dir).href,
			workspaceFolders: [{ uri: pathToFileURL(dir).href, name: 'root' }],
			initializationOptions: launch.init,
			capabilities: {
				window: { workDoneProgress: true },
				workspace: { configuration: true, workspaceFolders: true },
				textDocument: {
					references: {},
					callHierarchy: {},
					documentSymbol: { hierarchicalDocumentSymbolSupport: true }
				}
			}
		});
		lsp.notify('initialized', {});
		const path = join(dir, anchor.path);
		const uri = pathToFileURL(path).href;
		lsp.notify('textDocument/didOpen', {
			textDocument: {
				uri,
				languageId: languageId(path),
				version: 1,
				text: await readFile(path, 'utf8')
			}
		});
		const indexed = await lsp.settled(INDEX_GRACE_MS, INDEX_TIMEOUT_MS);
		report.step(
			`Started ${NAMES[server]} · ${indexed ? `ready in ${seconds(since)}` : `still indexing after ${INDEX_TIMEOUT_MS / 60_000} minutes`}`,
			[`${launch.command} ${launch.args.join(' ')}`, ...launch.notes].join('\n')
		);

		report.status('Finding what the lines declare');
		const tree =
			(await ask<DocumentSymbol[] | null>('textDocument/documentSymbol', {
				textDocument: { uri }
			})) ?? [];
		// ponytail: the Svelte server wraps a component's script in a symbol named after its
		// tag, and lists its markup's elements. What's in the script is looked into, and a line
		// in the markup stands for the component, whose uses are the wrapper's
		const scripts = server === 'svelte' ? tree.filter((s) => s.name === 'script') : [];
		const script = scripts[0];
		const inScript = (s: DocumentSymbol) =>
			scripts.some(
				(t) => t.range.start.line <= s.range.start.line && s.range.end.line <= t.range.end.line
			);
		const trace: string[] = [];
		let symbols = symbolsAt(
			tree,
			lines.map((n) => n - 1),
			(s) => script !== undefined && (scripts.includes(s) || !inScript(s)),
			trace
		);
		if (script && symbols.length === 0) {
			symbols = [{ ...script, name: basename(anchor.path), kind: COMPONENT }];
			trace.push('none of them in the script: the component itself');
		}
		const removed = selected.length - lines.length;
		if (removed) trace.push(`${removed} removed ${removed === 1 ? 'line' : 'lines'} left out`);
		report.step(
			`${lines.length === 1 ? `Line ${lines[0]} is` : `Lines ${lines[0]}–${lines.at(-1)} are`} in ${symbols.length ? symbols.map((s) => s.name).join(', ') : 'no declaration'}`,
			trace.join('\n')
		);
		const where = new Where(dir, files);
		const sections = [
			`${capitalize(NAMES[server])} read the repository at ${to ? `commit ${to}, checked out in ${dir}` : `its working tree, ${dir}`}.${
				indexed
					? ''
					: ` It hadn't finished indexing after ${INDEX_TIMEOUT_MS / 60_000} minutes, so uses may be missing.`
			}`
		];
		if (symbols.length === 0) {
			sections.push(
				"The selected lines aren't inside a declaration it knows, like a function, class or field. Search for what they affect yourself."
			);
		}
		for (const symbol of symbols.slice(0, MAX_SYMBOLS)) {
			since = Date.now();
			report.status(`Finding uses of ${symbol.name} with ${NAMES[server]}`);
			let found: Awaited<ReturnType<typeof usesOf>>;
			try {
				found = await usesOf(symbol, uri, ask, where);
			} catch (error) {
				// one that took too long, the others' uses still count
				if (signal.aborted) throw error;
				const why = `Couldn't find the uses of \`${symbol.name}\`: ${(error as Error).message}.`;
				report.step(`Couldn't find the uses of ${symbol.name}`, (error as Error).message);
				sections.push(why);
				continue;
			}
			const { text, count, left } = found;
			report.step(
				`Found ${count} ${count === 1 ? 'use' : 'uses'} of ${symbol.name} · ${seconds(since)}`,
				[
					text,
					left.length &&
						`Left out, generated or outside the repo:\n${left.map((p) => `- ${p}`).join('\n')}`
				]
					.filter(Boolean)
					.join('\n\n')
			);
			sections.push(text);
		}
		if (symbols.length > MAX_SYMBOLS) {
			const rest = symbols.slice(MAX_SYMBOLS).map((s) => `\`${s.name}\``);
			sections.push(`Not looked up, there were too many: ${rest.join(', ')}.`);
			report.step(`Left out ${rest.length} more`, rest.join(', '));
		}
		return `<static-analysis>\n${sections.join('\n\n')}\n</static-analysis>`;
	} finally {
		signal.removeEventListener('abort', kill);
		await lsp.close();
	}
}

type Ask = <T>(method: string, params: unknown) => Promise<T>;

interface Position {
	line: number;
	character: number;
}
interface Range {
	start: Position;
	end: Position;
}
interface Location {
	uri: string;
	range: Range;
}
export interface DocumentSymbol {
	name: string;
	kind: number;
	range: Range;
	selectionRange: Range;
	children?: DocumentSymbol[];
	/** a flat SymbolInformation, from servers that don't nest */
	location?: Location;
}
interface CallItem {
	name: string;
	uri: string;
	range: Range;
	selectionRange: Range;
}
interface IncomingCall {
	from: CallItem;
	fromRanges: Range[];
}

/** LSP SymbolKind: the ones that hold other declarations, looked into rather than taken */
const CONTAINERS = new Set([1, 2, 3, 4, 5, 10, 11, 19, 23]);
/**
 * and the ones too wide to be what a line is about: file, module, namespace, package, and
 * string, which is how clangd shows a macro expanding to declarations, like a namespace's opening
 */
const SCOPES = new Set([1, 2, 3, 4, 15]);
/** not a SymbolKind: a Svelte component, its script standing for it */
const COMPONENT = -1;
const KINDS: Record<number, string> = {
	[COMPONENT]: 'component',
	1: 'file',
	2: 'module',
	3: 'namespace',
	4: 'package',
	15: 'macro',
	5: 'class',
	6: 'method',
	7: 'property',
	8: 'field',
	9: 'constructor',
	10: 'enum',
	11: 'interface',
	12: 'function',
	13: 'variable',
	14: 'constant',
	22: 'enum member',
	23: 'struct',
	26: 'type parameter'
};

/**
 * The declarations the lines (0-based) are in: for each, the outermost one that isn't a
 * container like a class or namespace, so a line in a method is the method, not a local
 * in it, and one between a class's methods is the class. A namespace is never one, and
 * `wrapper` says which symbols only wrap others, to look into like containers.
 */
export function symbolsAt(
	found: DocumentSymbol[],
	lines: number[],
	wrapper: (symbol: DocumentSymbol) => boolean = () => false,
	/** for each line, the declarations around it and which was taken */
	trace?: string[]
): DocumentSymbol[] {
	const flat: DocumentSymbol[] = [];
	const walk = (list: DocumentSymbol[]) => {
		for (const s of list) {
			// the nested kind as it is, so `wrapper` can tell it by identity
			flat.push(
				s.location ? { ...s, range: s.location.range, selectionRange: s.location.range } : s
			);
			walk(s.children ?? []);
		}
	};
	walk(found);
	const size = (r: Range) =>
		(r.end.line - r.start.line) * 1e6 + r.end.character - r.start.character;
	const picked = new Map<string, DocumentSymbol>();
	for (const line of lines) {
		const around = flat
			.filter((s) => s.range.start.line <= line && line <= s.range.end.line)
			.sort((a, b) => size(b.range) - size(a.range));
		let pick: DocumentSymbol | undefined;
		for (const s of around) {
			if (wrapper(s) || SCOPES.has(s.kind)) continue;
			pick = s;
			if (!CONTAINERS.has(s.kind)) break;
		}
		if (pick) picked.set(`${pick.name}:${pick.selectionRange.start.line}`, pick);
		trace?.push(
			`${line + 1}: ${
				around
					.map((s) => `${s.name} (${KINDS[s.kind] ?? `kind ${s.kind}`})${s === pick ? ' ✓' : ''}`)
					.join(' › ') || 'no declaration'
			}`
		);
	}
	return [...picked.values()];
}

/** Paths and lines as the prompt shows them, relative to the checkout, and what the diff changed. */
class Where {
	#texts = new Map<string, Promise<string[]>>();
	#added: Set<string>;
	#ignored = new Map<string, Promise<boolean>>();

	constructor(
		readonly dir: string,
		files: DiffFile[]
	) {
		this.#added = new Set(
			files.flatMap((f) =>
				f.hunks.flatMap((h) =>
					h.lines.filter((l) => l.kind === 'add').map((l) => `${f.newPath}:${l.new}`)
				)
			)
		);
	}

	/** The path in the repo, null for one outside it or one git ignores, like generated code. */
	async path(uri: string): Promise<string | null> {
		if (!uri.startsWith('file:')) return null;
		const path = relative(this.dir, fileURLToPath(uri));
		if (path.startsWith('..') || path.startsWith(sep)) return null;
		let ignored = this.#ignored.get(path);
		if (!ignored) {
			// check-ignore exits with 1 when the path isn't ignored
			ignored = git(this.dir, ['check-ignore', '-q', '--', path]).then(
				() => true,
				() => false
			);
			this.#ignored.set(path, ignored);
		}
		return (await ignored) ? null : path;
	}

	/** One use: where, the line itself, and whether the diff changed it. */
	async line(path: string, line: number): Promise<string> {
		let text = this.#texts.get(path);
		if (!text) {
			text = readFile(join(this.dir, path), 'utf8').then(
				(t) => t.split('\n'),
				() => []
			);
			this.#texts.set(path, text);
		}
		const code = ((await text)[line - 1] ?? '').trim().slice(0, 160);
		const changed = this.#added.has(`${path}:${line}`) ? ' (changed in this diff)' : '';
		return `${path}:${line}${code && ` \`${code.replaceAll('`', "'")}\``}${changed}`;
	}
}

async function usesOf(
	symbol: DocumentSymbol,
	uri: string,
	ask: Ask,
	where: Where
): Promise<{ text: string; count: number; left: string[] }> {
	const at = { textDocument: { uri }, position: symbol.selectionRange.start };
	const declared = await where.path(uri);
	const head = `### \`${symbol.name}\`, ${KINDS[symbol.kind] ?? 'declaration'} at ${declared}:${symbol.selectionRange.start.line + 1}`;

	const [references, items] = await Promise.all([
		ask<Location[] | null>('textDocument/references', {
			...at,
			context: { includeDeclaration: false }
		}),
		// not every server walks calls, references are enough without it
		ask<CallItem[] | null>('textDocument/prepareCallHierarchy', at).catch(() => null)
	]);
	const callers: IncomingCall[] = [];
	for (const item of items ?? []) {
		callers.push(
			...((await ask<IncomingCall[] | null>('callHierarchy/incomingCalls', { item }).catch(
				() => null
			)) ?? [])
		);
	}

	// the function each use is in, from the calls
	const inside = new Map<string, string>();
	for (const call of callers) {
		for (const r of call.fromRanges) inside.set(`${call.from.uri}:${r.start.line}`, call.from.name);
	}
	const sites: string[] = [];
	const sorted = (references ?? []).sort(
		(a, b) => a.uri.localeCompare(b.uri) || a.range.start.line - b.range.start.line
	);
	const seen = new Set<string>();
	const left = new Set<string>();
	for (const ref of sorted) {
		const path = await where.path(ref.uri);
		const key = `${path}:${ref.range.start.line}`;
		if (!path) {
			left.add(ref.uri.startsWith('file:') ? relative(where.dir, fileURLToPath(ref.uri)) : ref.uri);
		}
		if (!path || seen.has(key)) continue;
		seen.add(key);
		const caller = inside.get(`${ref.uri}:${ref.range.start.line}`);
		sites.push(
			`- ${await where.line(path, ref.range.start.line + 1)}${caller ? ` in \`${caller}\`` : ''}`
		);
	}
	const shown = sites.slice(0, MAX_REFERENCES);
	if (sites.length > MAX_REFERENCES) shown.push(`- … and ${sites.length - MAX_REFERENCES} more`);

	// one level further up, for the ways in: who calls the callers
	const reached: string[] = [];
	for (const call of callers.slice(0, MAX_CALLERS)) {
		const path = await where.path(call.from.uri);
		if (!path) continue;
		const up =
			(await ask<IncomingCall[] | null>('callHierarchy/incomingCalls', { item: call.from }).catch(
				() => null
			)) ?? [];
		const names: string[] = [];
		for (const c of up) {
			const p = await where.path(c.from.uri);
			if (p) names.push(`\`${c.from.name}\` (${p}:${c.from.selectionRange.start.line + 1})`);
		}
		const named = names.slice(0, MAX_CALLERS_UP);
		if (names.length > MAX_CALLERS_UP) named.push(`and ${names.length - MAX_CALLERS_UP} more`);
		reached.push(
			`- \`${call.from.name}\` (${path}:${call.from.selectionRange.start.line + 1}) ← ${named.length ? named.join(', ') : 'nothing found'}`
		);
	}

	const text = [
		head,
		sites.length
			? `${sites.length} ${sites.length === 1 ? 'use' : 'uses'}:\n${shown.join('\n')}`
			: 'No uses found.',
		reached.length ? `Who calls the callers:\n${reached.join('\n')}` : ''
	]
		.filter(Boolean)
		.join('\n');
	return { text, count: sites.length, left: [...left] };
}

/** Files that often changed in the same commits as `path`, and aren't in this change. */
async function coChange(
	root: string,
	to: string,
	path: string,
	files: DiffFile[],
	report: Reporter
) {
	if (!path) return '';
	const log = await git(root, [
		'log',
		to || 'HEAD',
		`-${CO_CHANGE_COMMITS}`,
		'--full-diff',
		'--name-only',
		'--format=%x1f',
		'--',
		path
	]);
	const commits = log
		.split('\x1f')
		.map((c) => c.split('\n').filter(Boolean))
		.filter((c) => c.length > 0 && c.length <= CO_CHANGE_MAX_FILES);
	const counts = new Map<string, number>();
	for (const commit of commits) {
		for (const file of commit) if (file !== path) counts.set(file, (counts.get(file) ?? 0) + 1);
	}
	const changed = new Set(files.map((f) => f.newPath));
	const often = [...counts]
		// a few commits together say little, a short history makes every file look coupled
		.filter(([, n]) => n >= 3 && n / commits.length >= 0.2)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(
			([file, n]) =>
				`- ${file}: ${n} of ${commits.length}${changed.has(file) ? ', also in this change' : ''}`
		);
	report.step(
		`${often.length || 'No'} ${often.length === 1 ? 'file changes' : 'files change'} along in git history`,
		[
			`${commits.length} commits touching ${path} looked at, of its last ${CO_CHANGE_COMMITS}, ones over ${CO_CHANGE_MAX_FILES} files left out. A file counts when it's in at least 3 of them and 20%.`,
			...often
		].join('\n')
	);
	return often.length
		? `<co-change>\nFiles that changed in the same commits as ${path}, in its last ${commits.length} commits:\n${often.join('\n')}\n</co-change>`
		: '';
}

// one analysis at a time per repo: they share the checkout
function locked<T>(root: string, run: () => Promise<T>): Promise<T> {
	const next = (queues.get(root) ?? Promise.resolve()).then(run);
	queues.set(
		root,
		next.catch(() => {})
	);
	return next;
}

/** a question the server didn't answer in time */
class Late extends Error {}

function within<T>(promise: Promise<T>): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	const late = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(new Late(`the language server took over ${REQUEST_TIMEOUT_MS / 1000}s to answer`)),
			REQUEST_TIMEOUT_MS
		);
	});
	return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const exists = (path: string) =>
	stat(path).then(
		() => true,
		() => false
	);

/** The checkout at `to` held while a thread reads it, to let go of once its answer is in. */
export interface Hold {
	dir: string;
	release(): void;
}

/**
 * the commit each repo's checkout is held at and by how many, and each repo's analysis
 * queue. On globalThis like the jobs, a dev server module reload keeps them
 */
const store = globalThis as {
	__blast?: {
		holds: Map<
			string,
			{ to: string; count: number; ready: Promise<string>; freed: Promise<void>; free(): void }
		>;
		queues: Map<string, Promise<unknown>>;
	};
};
const { holds, queues } = (store.__blast ??= { holds: new Map(), queues: new Map() });

/**
 * The repo at `to` for a blast radius thread, kept there until it's released: threads
 * at the same commit share it, one at another commit waits for them to finish. The
 * working tree for uncommitted changes, held by no one.
 */
export async function holdCheckout(
	root: string,
	to: string,
	report: Reporter,
	signal: AbortSignal
): Promise<Hold> {
	if (!to) return { dir: root, release: () => {} };
	const since = Date.now();
	for (;;) {
		signal.throwIfAborted();
		const held = holds.get(root);
		if (held && held.to !== to) {
			report.status(`Waiting for a blast radius at ${held.to.slice(0, 7)} to finish`);
			await unlessAborted(held.freed, signal);
			continue;
		}
		let hold = held;
		if (!hold) {
			report.status(`Checking out ${to.slice(0, 7)}`);
			let free = () => {};
			const freed = new Promise<void>((resolve) => (free = resolve));
			hold = { to, count: 0, ready: checkoutAt(root, to), freed, free };
			holds.set(root, hold);
		}
		hold.count++;
		const mine = hold;
		let released = false;
		const release = () => {
			if (released) return;
			released = true;
			if (--mine.count === 0) {
				holds.delete(root);
				mine.free();
			}
		};
		try {
			const dir = await mine.ready;
			report.step(`Checked out ${to.slice(0, 7)} · ${seconds(since)}`, dir);
			return { dir, release };
		} catch (error) {
			release();
			throw error;
		}
	}
}

/** `promise`, or a rejection once `signal` aborts */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

/**
 * The repo at `to`, for the language servers: one worktree per repo kept next to its
 * guides and moved from commit to commit, so an index built for it stays mostly valid.
 */
async function checkoutAt(root: string, to: string): Promise<string> {
	const dir = join(repoDir(root), 'analysis');
	const top = await git(dir, ['rev-parse', '--show-toplevel']).then(
		(t) => t.trim(),
		() => ''
	);
	if (top && top === (await realpath(dir))) {
		await git(dir, [
			'-c',
			'advice.detachedHead=false',
			'checkout',
			'-q',
			'--detach',
			'--force',
			to
		]);
	} else {
		// missing, or not a worktree anymore. --force takes over a registration left behind
		await rm(dir, { recursive: true, force: true });
		await mkdir(dirname(dir), { recursive: true });
		await git(root, ['worktree', 'add', '-q', '--detach', '--force', dir, to]);
	}
	await borrowBuildInputs(root, dir);
	return realpath(dir);
}

/**
 * What a fresh checkout lacks to type check, taken from the working tree: installed
 * packages, linked, and SvelteKit's generated types, copied since its tsconfig points
 * at the sources beside it.
 */
async function borrowBuildInputs(root: string, dir: string) {
	const packages = (await git(root, ['ls-files', '--', 'package.json', '*/package.json']))
		.split('\n')
		.filter(Boolean)
		.map(dirname);
	for (const pkg of packages) {
		const [from, to] = [join(root, pkg), join(dir, pkg)];
		if (!(await exists(to))) continue;
		if ((await exists(join(from, 'node_modules'))) && !(await exists(join(to, 'node_modules')))) {
			await symlink(join(from, 'node_modules'), join(to, 'node_modules'));
		}
		const kit = join(from, '.svelte-kit');
		if (await exists(kit)) {
			await cp(kit, join(to, '.svelte-kit'), {
				recursive: true,
				force: true,
				filter: (path) => !path.startsWith(join(kit, 'output'))
			});
		}
	}
}

const require = createRequire(import.meta.url);

type Launch =
	| {
			command: string;
			args: string[];
			init?: object;
			/** how it was set up, for the reader */
			notes: string[];
	  }
	| { missing: string };

async function launchFor(server: Server, root: string, dir: string): Promise<Launch> {
	if (server === 'typescript') {
		// the repo's own compiler when it has one, it's what its code is written against
		const own = join(dir, 'node_modules/typescript/lib/tsserver.js');
		const plugin = require.resolve('typescript-svelte-plugin');
		const tsserver = (await exists(own)) ? own : require.resolve('typescript/lib/tsserver.js');
		return {
			command: process.execPath,
			args: [require.resolve('typescript-language-server/lib/cli.mjs'), '--stdio'],
			init: {
				tsserver: { path: tsserver },
				// uses in .svelte files too
				plugins: [
					{
						name: 'typescript-svelte-plugin',
						location: plugin.slice(0, plugin.lastIndexOf(`${sep}node_modules${sep}`)),
						languages: ['svelte']
					}
				]
			},
			notes: [`tsserver: ${tsserver}`, `plugin: ${plugin}`]
		};
	}
	if (server === 'svelte') {
		return {
			command: process.execPath,
			args: [require.resolve('svelte-language-server/bin/server.js'), '--stdio'],
			notes: []
		};
	}

	const found = await compileCommands(root);
	if (!found) {
		return {
			missing:
				"clangd needs the compile_commands.json a build writes, and there's none at the top of the repo or in a folder one down (CMake writes one with -DCMAKE_EXPORT_COMPILE_COMMANDS=ON)."
		};
	}
	// a folder of its own for the copy, clangd keeps its index next to it
	const folder = join(repoDir(root), 'clangd', dir === root ? 'root' : 'analysis');
	await mkdir(folder, { recursive: true });
	const build = dirname(await realpath(found));
	const text = moveCompileCommands(await readFile(found, 'utf8'), root, dir, build);
	const target = join(folder, 'compile_commands.json');
	if ((await readFile(target, 'utf8').catch(() => '')) !== text) await writeFile(target, text);
	return {
		command: env.CLANGD_BIN || 'clangd',
		args: ['--background-index', '--log=error', `--compile-commands-dir=${folder}`],
		notes: [`compile_commands.json: ${found}, moved to the checkout in ${target}`]
	};
}

/** The compile_commands.json a build wrote: at the top of the repo, or in a folder one down. */
async function compileCommands(root: string): Promise<string | null> {
	const top = join(root, 'compile_commands.json');
	if (await exists(top)) return top;
	const entries = await readdir(root, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules')
			continue;
		const path = join(root, entry.name, 'compile_commands.json');
		if (await exists(path)) return path;
	}
	return null;
}

const capitalize = (text: string) => text[0].toUpperCase() + text.slice(1);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * compile_commands.json for a checkout of the repo at `dir`: its sources there, the
 * build folder left where it was built, since generated headers live only there.
 */
export function moveCompileCommands(
	text: string,
	root: string,
	dir: string,
	build: string
): string {
	if (root === dir) return text;
	const inside = relative(root, build);
	// ponytail: relative paths resolve against the unmoved build folder, so a build that
	// writes them (not CMake) reads the working tree's sources
	const end = `(?=[/\\s"']|$)`;
	const notBuild = inside && !inside.startsWith('..') ? `(?!/${escape(inside)}${end})` : '';
	const pattern = new RegExp(`${escape(root)}${notBuild}${end}`, 'g');
	// ponytail: no boundary on the left, a path that only ends in `root`, like /mnt/src/repo
	// for /src/repo, moves too
	const move = (value: unknown) =>
		typeof value === 'string' ? value.replace(pattern, () => dir) : value;
	const entries = JSON.parse(text) as Record<string, unknown>[];
	return JSON.stringify(
		entries.map((entry) => ({
			...entry,
			directory: move(entry.directory),
			file: move(entry.file),
			...(entry.command !== undefined && { command: move(entry.command) }),
			...(Array.isArray(entry.arguments) && { arguments: entry.arguments.map(move) }),
			...(entry.output !== undefined && { output: move(entry.output) })
		})),
		null,
		1
	);
}
