import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, normalize } from 'node:path';
import { parseDiff } from '$lib/diff/parse';
import type { DiffFile } from '$lib/diff/types';
import type {
	ChangeMap,
	MapEdge,
	MapNode,
	NodeRef,
	NodeStatus,
	UseKind,
	Way
} from '$lib/map/types';
import {
	COMPONENT,
	declarationsAt,
	holdCheckout,
	KINDS,
	serverFor,
	startSession,
	symbolsAt,
	Where,
	yielders,
	type DocumentSymbol,
	type Server,
	type Session
} from './blast';
import { readDiff } from './git';
import { log } from './log';

/**
 * The change as a map: the declarations it touches and what uses them, found by the
 * language servers at the change's head commit, and from there more on request: who
 * uses a declaration, what it uses, what's in it. Facts only, no agent reads it.
 */

/** declarations whose uses are looked up for the first map, a sweeping change touches hundreds */
const MAX_TOUCHED = 60;
/** uses followed for each */
const MAX_REFERENCES = 100;
/** members whose uses are looked up when a declaration is opened */
const MAX_MEMBERS = 30;
/** language servers are kept this long after the last question */
const IDLE_MS = 3 * 60_000;
/** a line that brings in or passes on another file's declarations, not a use of them */
const IMPORT = /^\s*(import\b|export\s*(\*|\{[^}]*\}\s*from)|#\s*include\b)/;
/** LSP SymbolKinds whose children are members worth opening into */
const OPENS = new Set([COMPONENT, 5, 10, 11, 23]);

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
interface CallItem {
	name: string;
	uri: string;
	range: Range;
	selectionRange: Range;
}

/** The diff's lines on the new side, 0-based: what they touch, and which were added. */
export function changedLines(file: DiffFile): {
	touched: Map<number, string>;
	added: Set<number>;
	/** how many lines were removed at each line, the one before them on the new side */
	removed: Map<number, number>;
} {
	const touched = new Map<number, string>();
	const added = new Set<number>();
	const removed = new Map<number, number>();
	for (const hunk of file.hunks) {
		let last: number | null = null;
		for (const line of hunk.lines) {
			if (line.new !== null) last = line.new - 1;
			if (line.kind === 'add' && line.new !== null) {
				touched.set(line.new - 1, hunk.id);
				added.add(line.new - 1);
			}
			// a removal touches what it was removed from, the line before it on the new side
			if (line.kind === 'del') {
				const at = last ?? Math.max(hunk.newStart - 1, 0);
				touched.set(at, hunk.id);
				removed.set(at, (removed.get(at) ?? 0) + 1);
			}
		}
	}
	return { touched, added, removed };
}

/** LSP SymbolKinds that are all outside, no body: interface, enum, struct, type parameter */
const TYPEISH = new Set([10, 11, 23, 26]);
/** how far down a declaration's outside is looked for its body's start */
const HEAD_LINES = 30;

/**
 * The line a declaration's outside ends on: its name, parameters, type, what it extends,
 * up to where its body starts, a `{` or `=>` outside any brackets.
 */
export function headEnd(text: string[], from: Position, last: number): number {
	let depth = 0;
	for (let n = from.line; n <= Math.min(last, from.line + HEAD_LINES); n++) {
		const line = text[n] ?? '';
		for (let i = n === from.line ? from.character : 0; i < line.length; i++) {
			const ch = line[i];
			if (ch === '(' || ch === '[' || ch === '<') depth++;
			else if (ch === ')' || ch === ']' || (ch === '>' && line[i - 1] !== '=')) {
				depth = Math.max(0, depth - 1);
			} else if (depth === 0 && (ch === '{' || (ch === '=' && line[i + 1] === '>'))) return n;
		}
	}
	return from.line;
}

/**
 * The change touches a declaration's outside, what its users see, not only its body: the
 * lines of its name, parameters and type; all of a type, an interface or an enum; a class's
 * methods' outsides; a component's props.
 */
export function signatureChanged(
	symbol: DocumentSymbol,
	touched: Iterable<number>,
	text: string[]
) {
	const lines = [...touched];
	const hit = (from: number, to: number) => lines.some((n) => from <= n && n <= to);
	const outside = (s: DocumentSymbol) =>
		hit(s.range.start.line, headEnd(text, s.selectionRange.start, s.range.end.line));
	if (symbol.kind === COMPONENT) {
		return (
			(symbol.children ?? []).some(
				(c) => c.name === 'Props' && hit(c.range.start.line, c.range.end.line)
			) || lines.some((n) => /\$props\s*\(/.test(text[n] ?? ''))
		);
	}
	const start = symbol.range.start.line;
	if (
		TYPEISH.has(symbol.kind) ||
		/^\s*(export\s+)?(declare\s+)?(type|interface|enum)\s/.test(text[start] ?? '')
	) {
		return hit(start, symbol.range.end.line);
	}
	return outside(symbol) || (symbol.kind === 5 && (symbol.children ?? []).some(outside));
}

/** Every line of `range` is in `lines`: a declaration the change wrote whole. */
export const wholly = (range: { start: Position; end: Position }, lines: Set<number>) => {
	for (let n = range.start.line; n <= range.end.line; n++) if (!lines.has(n)) return false;
	return true;
};

/**
 * How the name at `start`–`end` of `line` is used. `markup`: the file has tags, a
 * capitalised one is a component.
 */
export function useKind(line: string, start: number, end: number, markup: boolean): UseKind {
	const before = line.slice(0, start);
	const after = line.slice(end);
	if (markup && /<\/?\s*$/.test(before)) return 'render';
	if (markup && /<[A-Z][\w.]*\s[^<>]*$/.test(before) && /^\s*[=}]/.test(after)) return 'prop';
	if (/^\s*\(/.test(after) || /\bnew\s+$/.test(before)) return 'call';
	if (/^\s*(=(?!=)|\+=|-=|\+\+|--)/.test(after)) return 'write';
	if (
		/(:|\bextends|\bimplements|\bas|\bsatisfies|\||&)\s*$/.test(before) ||
		/^\s*(export\s+)?(type|interface)\b/.test(line) ||
		// inside a type's arguments, outside markup where a `<` is a tag
		(!markup && count(before, '<') > count(before, '>'))
	) {
		return 'type';
	}
	return 'read';
}

const count = (text: string, char: string) => text.split(char).length - 1;

/** One declaration found at a line: its node, and the outermost one's when it's a member. */
interface Found {
	node: MapNode;
	top: MapNode;
}

/**
 * The repo at one commit as the language servers read it, kept to answer more about the
 * same change. Every node it returns says where it is and whether the change touched it.
 */
/** The map has no progress to show, what the analysis is up to goes to the terminal. */
const toLog = { status: (text: string) => log('map', text), step: () => {} };

export class Reader {
	notes: string[] = [];
	#sessions = new Map<Server, Promise<Session | { missing: string }>>();
	#trees = new Map<string, Promise<DocumentSymbol[]>>();
	#texts = new Map<string, Promise<string[]>>();
	#where: Where;
	#lines: Map<string, ReturnType<typeof changedLines>>;
	#added: Set<string>;

	constructor(
		readonly root: string,
		readonly dir: string,
		readonly files: DiffFile[],
		readonly signal: AbortSignal
	) {
		this.#where = new Where(dir, files);
		this.#lines = new Map(files.map((f) => [f.newPath, changedLines(f)]));
		this.#added = new Set(files.filter((f) => f.status === 'added').map((f) => f.newPath));
	}

	async #session(path: string) {
		const server = serverFor(path);
		if (!server) return null;
		let session = this.#sessions.get(server);
		if (!session) {
			session = startSession(server, this.root, this.dir, path, toLog, this.signal);
			this.#sessions.set(server, session);
		}
		const started = await session;
		if ('missing' in started) {
			if (!this.notes.includes(started.missing)) this.notes.push(started.missing);
			return null;
		}
		return { server, session: started };
	}

	#tree(path: string, session: Session) {
		let tree = this.#trees.get(path);
		if (!tree) {
			tree = session.symbols(path).catch(() => []);
			this.#trees.set(path, tree);
		}
		return tree;
	}

	#text(path: string) {
		let text = this.#texts.get(path);
		if (!text) {
			text = readFile(join(this.dir, path), 'utf8').then(
				(t) => t.split('\n'),
				() => []
			);
			this.#texts.set(path, text);
		}
		return text;
	}

	/** A path the page sent, checked to be inside the repo. */
	static checkPath(path: string): string {
		const clean = normalize(path);
		if (isAbsolute(clean) || clean.startsWith('..')) throw new Error(`${path} isn't in the repo`);
		return clean;
	}

	#node(path: string, symbol: DocumentSymbol, parent?: string, text?: string[]): MapNode {
		const at = symbol.selectionRange.start;
		const lines = this.#lines.get(path);
		const hunks: string[] = [];
		for (const [line, hunk] of lines?.touched ?? []) {
			if (symbol.range.start.line <= line && line <= symbol.range.end.line) {
				if (!hunks.includes(hunk)) hunks.push(hunk);
			}
		}
		const status: NodeStatus = !hunks.length
			? 'affected'
			: this.#added.has(path) || wholly(symbol.range, lines!.added)
				? 'added'
				: 'modified';
		const signature =
			hunks.length > 0 &&
			text !== undefined &&
			signatureChanged(symbol, lines?.touched.keys() ?? [], text);
		// how much of it the change wrote and took away
		const within = (n: number) => symbol.range.start.line <= n && n <= symbol.range.end.line;
		const plus = [...(lines?.added ?? [])].filter(within).length;
		const minus = [...(lines?.removed ?? [])].reduce((sum, [n, k]) => sum + (within(n) ? k : 0), 0);
		// the TypeScript server lists a type alias as a variable
		const alias = /^\s*(export\s+)?(declare\s+)?type\s/.test(text?.[symbol.range.start.line] ?? '');
		return {
			id: `${path}:${at.line}:${at.character}`,
			name: symbol.name,
			kind: alias ? 'type' : (KINDS[symbol.kind] ?? 'declaration'),
			path,
			line: at.line + 1,
			char: at.character,
			status,
			hunks,
			...(signature && { signature: true as const }),
			...(hunks.length > 0 && { plus, minus }),
			...(this.#added.has(path) && { newFile: true as const }),
			...(parent && { parent }),
			...(OPENS.has(symbol.kind) &&
				(symbol.children?.length ?? 0) > 0 && { members: true as const })
		};
	}

	/**
	 * The map's declaration the line (0-based) is in, the outermost, so a method's is its
	 * class and anything in a Svelte component's is the component, and the member of it
	 * the line is in. None for an import or a line outside any.
	 */
	async #at(path: string, line: number): Promise<Found | null> {
		const found = await this.#session(path);
		if (!found) return null;
		const [tree, text] = await Promise.all([this.#tree(path, found.session), this.#text(path)]);
		if (IMPORT.test(text[line] ?? '')) return null;
		let top: DocumentSymbol | undefined;
		let inner: DocumentSymbol | undefined;
		if (found.server === 'svelte') {
			top = this.#component(path, tree, text);
			inner = declarationsAt(tree, [line], 'svelte', path).find((s) => s.kind !== COMPONENT);
		} else {
			[top] = symbolsAt(tree, [line], undefined, undefined, true);
			[inner] = symbolsAt(tree, [line]);
		}
		if (!top) return null;
		const outer = this.#node(path, top, undefined, text);
		const same =
			!inner ||
			(inner.selectionRange.start.line === top.selectionRange.start.line &&
				inner.selectionRange.start.character === top.selectionRange.start.character);
		return { node: same ? outer : this.#node(path, inner!, outer.id, text), top: outer };
	}

	/** The change touches the declaration `ref` names. */
	async #touches(path: string, ref: NodeRef): Promise<boolean> {
		const touched = this.#lines.get(path)?.touched;
		if (!touched?.size) return false;
		const found = await this.#session(path);
		if (!found) return false;
		// a component's file is touched, so whatever's in it might be
		if (found.server === 'svelte') return true;
		const symbol = findSymbol(await this.#tree(path, found.session), ref.line - 1, ref.char);
		return (
			!symbol ||
			[...touched.keys()].some((n) => symbol.range.start.line <= n && n <= symbol.range.end.line)
		);
	}

	/** A Svelte component as one declaration, its script's as its members. */
	#component(path: string, tree: DocumentSymbol[], text: string[]): DocumentSymbol {
		const whole = {
			start: { line: 0, character: 0 },
			end: { line: Math.max(text.length - 1, 0), character: 0 }
		};
		const script = tree.find((s) => s.name === 'script');
		return {
			name: basename(path),
			kind: COMPONENT,
			range: whole,
			selectionRange: script?.selectionRange ?? whole,
			children: script?.children ?? []
		};
	}

	/** The declarations the change touches, the deleted files among them, and their users. */
	async map(): Promise<ChangeMap> {
		const part = new Part();
		const touched: MapNode[] = [];
		for (const file of this.files) {
			if (file.binary) continue;
			if (file.status === 'deleted') {
				part.node({
					id: `${file.oldPath}:file`,
					name: basename(file.oldPath),
					kind: 'file',
					path: file.oldPath,
					line: 1,
					char: 0,
					status: 'removed',
					hunks: file.hunks.map((h) => h.id)
				});
				continue;
			}
			for (const line of this.#lines.get(file.newPath)!.touched.keys()) {
				const found = await this.#at(file.newPath, line);
				if (found && !part.has(found.top.id)) {
					part.node(found.top);
					touched.push(found.top);
				}
			}
		}
		if (touched.length > MAX_TOUCHED) {
			this.notes.push(
				`Uses of ${touched.length - MAX_TOUCHED} more declarations weren't looked up.`
			);
		}
		for (const node of touched.slice(0, MAX_TOUCHED)) {
			part.add(await this.users(node));
			// a class's or an interface's own name is used in few places, its members are what's
			// read and called: their uses are found now, not only once it's opened. A component's
			// members are used inside it, the outside renders it
			if (node.members && node.kind !== 'component') part.add(await this.members(node));
		}
		return part.done(this.notes);
	}

	/** Where `target` is used, each use by the declaration it's in. */
	async users(target: NodeRef): Promise<ChangeMap> {
		this.signal.throwIfAborted();
		const part = new Part();
		const path = Reader.checkPath(target.path);
		const found = await this.#session(path);
		if (!found) return part.done(this.notes);
		const refs =
			(await found.session
				.ask<Location[] | null>('textDocument/references', {
					textDocument: { uri: await found.session.open(path) },
					position: { line: target.line - 1, character: target.char },
					context: { includeDeclaration: false }
				})
				.catch(() => null)) ?? [];
		const sites: { path: string; line: number; from: string }[] = [];
		for (const ref of refs.slice(0, MAX_REFERENCES)) {
			const at = await this.#where.path(ref.uri);
			if (!at) continue;
			const line = ref.range.start.line;
			// ponytail: a use outside any declaration, like an import or a re-export, isn't
			// one, so top-level code that calls it is missed too
			const user = await this.#at(at, line);
			if (!user || user.node.id === target.id || user.top.id === target.id) continue;
			const text = (await this.#text(at))[line] ?? '';
			part.node(user.top);
			part.node(user.node);
			part.edge({
				from: user.node.id,
				to: target.id,
				count: 1,
				added: this.#lines.get(at)?.added.has(line) ?? false,
				use: useKind(text, ref.range.start.character, ref.range.end.character, markup(at)),
				sample: text.trim().slice(0, 160),
				at: line + 1
			});
			sites.push({ path: at, line, from: user.node.id });
		}
		// a use of what the change touched that no longer type-checks, the server's own error there
		if (sites.length && (await this.#touches(path, target))) {
			const errors = new Map(
				await Promise.all(
					[...new Set(sites.map((s) => s.path))].map(
						async (at) => [at, (await (await this.#session(at))?.session.errors(at)) ?? []] as const
					)
				)
			);
			for (const site of sites) {
				const error = errors
					.get(site.path)!
					.find((e) => e.range.start.line <= site.line && site.line <= e.range.end.line);
				const edge = part.get(site.from, target.id);
				if (error && edge && !edge.broken) edge.broken = error.message.split('\n')[0].slice(0, 200);
			}
		}
		if (refs.length > MAX_REFERENCES) {
			part.notes.push(`Only the first ${MAX_REFERENCES} uses of ${target.id} were followed.`);
		}
		return part.done(this.notes);
	}

	/**
	 * What `source` uses: the calls it makes, or for a component or a declaration with
	 * members, what its members call and a component imports.
	 */
	async uses(source: NodeRef): Promise<ChangeMap> {
		this.signal.throwIfAborted();
		const part = new Part();
		const path = Reader.checkPath(source.path);
		const found = await this.#session(path);
		if (!found) return part.done(this.notes);
		const { session } = found;
		const uri = await session.open(path);
		const text = await this.#text(path);

		const link = async (
			from: string,
			to: { uri: string; line: number },
			use: UseKind,
			sample: string,
			/** where in `source`'s file, 0-based */
			site?: number
		) => {
			const at = await this.#where.path(to.uri);
			if (!at) return;
			const target = await this.#at(at, to.line);
			if (!target || target.top.id === source.id || target.node.id === source.id) return;
			part.node(target.top);
			part.node(target.node);
			part.edge({
				from,
				to: target.node.id,
				count: 1,
				added: false,
				use,
				sample,
				...(site !== undefined && { at: site + 1 })
			});
		};

		if (found.server === 'svelte' || source.kind === 'file' || source.kind === 'tests') {
			for (const name of importedNames(text)) {
				const [def] = locations(
					await session
						.ask<unknown>('textDocument/definition', {
							textDocument: { uri },
							position: { line: name.line, character: name.character }
						})
						.catch(() => null)
				);
				if (def) {
					await link(source.id, def, 'import', text[name.line].trim().slice(0, 160), name.line);
				}
			}
			return part.done(this.notes);
		}

		// a class's or an interface's calls are its members'
		const tree = await this.#tree(path, session);
		const symbol = findSymbol(tree, source.line - 1, source.char);
		const callers =
			symbol && OPENS.has(symbol.kind) ? (symbol.children ?? []) : symbol ? [symbol] : [];
		for (const caller of callers.slice(0, MAX_MEMBERS)) {
			const items =
				(await session
					.ask<CallItem[] | null>('textDocument/prepareCallHierarchy', {
						textDocument: { uri },
						position: caller.selectionRange.start
					})
					.catch(() => null)) ?? [];
			for (const item of items) {
				const calls =
					(await session
						.ask<{ to: CallItem; fromRanges: Range[] }[] | null>('callHierarchy/outgoingCalls', {
							item
						})
						.catch(() => null)) ?? [];
				for (const call of calls) {
					const site = call.fromRanges[0]?.start.line;
					const from = site === undefined ? null : await this.#at(path, site);
					await link(
						from?.node.id ?? source.id,
						{ uri: call.to.uri, line: call.to.selectionRange.start.line },
						'call',
						site === undefined ? '' : (text[site] ?? '').trim().slice(0, 160),
						site
					);
				}
			}
		}
		if (!callers.length) part.notes.push(`Couldn't find what ${source.id} uses.`);
		return part.done(this.notes);
	}

	/** What's in `parent`: its members, and the uses of the ones the change touched. */
	async members(parent: NodeRef): Promise<ChangeMap> {
		this.signal.throwIfAborted();
		const part = new Part();
		const path = Reader.checkPath(parent.path);
		const found = await this.#session(path);
		if (!found) return part.done(this.notes);
		const [tree, text] = await Promise.all([this.#tree(path, found.session), this.#text(path)]);
		const symbol =
			found.server === 'svelte'
				? this.#component(path, tree, text)
				: findSymbol(tree, parent.line - 1, parent.char);
		const members = (symbol?.children ?? [])
			.filter((s) => !IMPORT.test(text[s.selectionRange.start.line] ?? ''))
			.map((s) => this.#node(path, s, parent.id, text));
		for (const member of members) part.node(member);
		const changed = members.filter((m) => m.status !== 'affected');
		for (const member of changed.slice(0, MAX_MEMBERS)) part.add(await this.users(member));
		return part.done(this.notes);
	}

	async close() {
		for (const session of this.#sessions.values()) {
			await session.then((s) => ('close' in s ? s.close() : undefined)).catch(() => {});
		}
	}
}

/** Nodes and edges collected for one answer, each once. */
class Part {
	#nodes = new Map<string, MapNode>();
	#edges = new Map<string, MapEdge>();
	notes: string[] = [];

	has = (id: string) => this.#nodes.has(id);
	get = (from: string, to: string) => this.#edges.get(`${from}>${to}`);

	node(node: MapNode) {
		if (!this.#nodes.has(node.id)) this.#nodes.set(node.id, node);
	}

	edge(edge: MapEdge) {
		const key = `${edge.from}>${edge.to}`;
		const had = this.#edges.get(key);
		if (!had) this.#edges.set(key, edge);
		else {
			had.count += edge.count;
			had.added ||= edge.added;
		}
	}

	add(map: ChangeMap) {
		for (const node of map.nodes) this.node(node);
		for (const edge of map.edges) this.edge({ ...edge });
		for (const note of map.notes) if (!this.notes.includes(note)) this.notes.push(note);
	}

	done(notes: string[]): ChangeMap {
		return {
			nodes: [...this.#nodes.values()],
			edges: [...this.#edges.values()],
			notes: [...new Set([...notes, ...this.notes])]
		};
	}
}

const markup = (path: string) => /\.(svelte|[jt]sx)$/.test(path);

/** The declaration whose name is at `line`:`character`, however deep. */
function findSymbol(
	tree: DocumentSymbol[],
	line: number,
	character: number
): DocumentSymbol | null {
	for (const s of tree) {
		const at = s.selectionRange.start;
		if (at.line === line && at.character === character) return s;
		const inner = findSymbol(s.children ?? [], line, character);
		if (inner) return inner;
	}
	return null;
}

/** Where a definition answer points, whichever of the shapes LSP allows it came in. */
function locations(answer: unknown): { uri: string; line: number }[] {
	const list = Array.isArray(answer) ? answer : answer ? [answer] : [];
	return list.flatMap(
		(l: Partial<Location> & { targetUri?: string; targetSelectionRange?: Range }) =>
			l.targetUri && l.targetSelectionRange
				? [{ uri: l.targetUri, line: l.targetSelectionRange.start.line }]
				: l.uri && l.range
					? [{ uri: l.uri, line: l.range.start.line }]
					: []
	);
}

/** The names a file's imports bring in, where each is written. */
export function importedNames(text: string[]): Position[] {
	const source = text.join('\n');
	const starts = [0];
	for (const line of text) starts.push(starts.at(-1)! + line.length + 1);
	const at = (offset: number): Position => {
		let line = 0;
		while (starts[line + 1] <= offset) line++;
		return { line, character: offset - starts[line] };
	};
	const names: Position[] = [];
	for (const m of source.matchAll(/\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+['"]/g)) {
		const clause = m[2];
		const offset = m.index + m[0].indexOf(clause, m[0].indexOf('import') + 6);
		// the name brought in: after `as` where there's one
		for (const n of clause.matchAll(/([A-Za-z_$][\w$]*)(\s+as\s+([A-Za-z_$][\w$]*))?/g)) {
			if (n[1] === 'type' || n[1] === 'as') continue;
			const name = n[3] ?? n[1];
			names.push(at(offset + n.index + (n[3] ? n[0].lastIndexOf(name) : 0)));
		}
	}
	return names;
}

interface Warm {
	key: string;
	reader: Promise<Reader>;
	busy: number;
	/** let go once nothing's being asked */
	wanted: boolean;
	timer?: NodeJS.Timeout;
	close(): Promise<void>;
}

// on globalThis like the checkouts, a dev server module reload keeps them
const store = globalThis as { __changeMaps?: Map<string, Warm> };
const warm = (store.__changeMaps ??= new Map());

/**
 * Runs `use` with a reader of the change from `from` to `to`, the one already running
 * for the repo when it's for the same change. Its language servers stop a few minutes
 * after the last question, or as soon as another analysis wants the checkout elsewhere.
 */
export async function withReader<T>(
	root: string,
	from: string,
	to: string,
	use: (reader: Reader) => Promise<T>
): Promise<T> {
	const key = `${from}..${to}`;
	let entry = warm.get(root);
	if (entry && entry.key !== key) {
		await entry.close();
		entry = undefined;
	}
	if (!entry) {
		const stop = new AbortController();
		let release = () => {};
		const reader = (async () => {
			const files = parseDiff(await readDiff(root, from, to));
			const hold = await holdCheckout(root, to, toLog, stop.signal);
			release = hold.release;
			return new Reader(root, hold.dir, files, stop.signal);
		})();
		const made: Warm = {
			key,
			reader,
			busy: 0,
			wanted: false,
			async close() {
				clearTimeout(made.timer);
				if (warm.get(root) === made) warm.delete(root);
				if (yielders.get(root) === yieldNow) yielders.delete(root);
				stop.abort();
				await reader.then((r) => r.close()).catch(() => {});
				release();
			}
		};
		const yieldNow = () => {
			made.wanted = true;
			if (made.busy === 0) void made.close();
		};
		warm.set(root, made);
		yielders.set(root, yieldNow);
		reader.catch(() => made.close());
		entry = made;
	}
	const mine = entry;
	clearTimeout(mine.timer);
	mine.busy++;
	try {
		return await use(await mine.reader);
	} finally {
		if (--mine.busy === 0) {
			if (mine.wanted) void mine.close();
			else mine.timer = setTimeout(() => void mine.close(), IDLE_MS);
		}
	}
}

/** One of the questions a map can ask, by name. */
export function ask(reader: Reader, way: Way, node: NodeRef): Promise<ChangeMap> {
	if (way === 'users') return reader.users(node);
	if (way === 'uses') return reader.uses(node);
	if (way === 'members') return reader.members(node);
	throw new Error(`Can't ask for ${way}`);
}
