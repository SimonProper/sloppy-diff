import type { Node, Slice } from 'prosemirror-model';
import {
	Plugin,
	PluginKey,
	Selection,
	TextSelection,
	type EditorState,
	type Transaction
} from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { closeHistory, redo, undo } from 'prosemirror-history';

/**
 * Vim's keys in a field, as far as they make sense in a comment: modes, motions, operators with
 * a motion or a word, counts, one register. Up and down move as the arrows do, by the line on
 * screen, so a wrapped paragraph is moved through like any other text. ponytail: no `.`, no named
 * registers, no marks or macros, add them when they're missed.
 */

type Mode = 'insert' | 'normal' | 'visual' | 'line';
interface Vim {
	on: boolean;
	mode: Mode;
	/** where v or V started, the selection running from it to the cursor */
	anchor: number;
}

export const vimKey = new PluginKey<Vim>('vim');
const get = (state: EditorState): Vim =>
	vimKey.getState(state) ?? { on: false, mode: 'insert', anchor: 0 };
/** insert while vim's keys are off */
export const modeOf = (state: EditorState): Mode => get(state).mode;
/** switched on or off, the field starting over in insert mode */
export const setVim = (tr: Transaction, on: boolean) => tr.setMeta(vimKey, { on, mode: 'insert' });
// each command undone on its own, and what's typed after i apart from it
const to = (tr: Transaction, mode: Mode, anchor?: number) =>
	closeHistory(tr).setMeta(vimKey, anchor === undefined ? { mode } : { mode, anchor });

// what was deleted or yanked, for p: some characters, whole blocks, or lines of a code block
type Register = { kind: 'chars' | 'blocks'; slice: Slice } | { kind: 'code'; text: string };
let register: Register | null = null;

/** Esc: from typing or a selection back to normal mode. False in normal mode, to close the field. */
export function vimEscape(view: EditorView): boolean {
	const { on, mode } = get(view.state);
	if (!on || mode === 'normal') return false;
	const { head, $head } = view.state.selection;
	// as in vim, back onto the character just typed
	const back = mode === 'insert' && head > $head.start() ? head - 1 : head;
	view.dispatch(
		to(view.state.tr.setSelection(TextSelection.create(view.state.doc, back)), 'normal')
	);
	return true;
}

export function vim(on: boolean) {
	// keys typed so far of a command, and the column j and k keep to
	let pending = '';
	const goal: { x?: number } = {};

	return new Plugin<Vim>({
		key: vimKey,
		state: {
			init: () => ({ on, mode: 'insert', anchor: 0 }),
			apply: (tr, value) => {
				const meta = tr.getMeta(vimKey);
				return meta ? { ...value, ...meta } : value;
			}
		},
		// out of insert mode the cursor is on a character, so not past a line's last one: a after it
		appendTransaction(_, __, state) {
			const { on, mode } = get(state);
			const { empty, head, $head } = state.selection;
			if (!on || mode === 'insert' || !empty || !$head.parent.inlineContent) return null;
			const { doc } = state;
			const atEnd = head === $head.end() || doc.textBetween(head, head + 1) === '\n';
			const atStart = head === $head.start() || doc.textBetween(head - 1, head) === '\n';
			return atEnd && !atStart ? state.tr.setSelection(TextSelection.create(doc, head - 1)) : null;
		},
		props: {
			handleKeyDown(view, event) {
				const { on, mode } = get(view.state);
				if (!on) return false;
				if (event.key === 'Escape') {
					pending = '';
					return vimEscape(view);
				}
				if (mode === 'insert' || event.isComposing) return false;
				const redoing = event.ctrlKey && event.key === 'r';
				// ⌘↵ still sends, ⌘z still undoes
				if ((event.metaKey || event.ctrlKey || event.altKey) && !redoing) return false;
				const key = redoing ? '\x12' : (ALIASES[event.key] ?? event.key);
				// the arrows and the rest as they are, anything typed is a command
				if (key.length !== 1) return false;
				pending += key;
				const command = parse(pending, mode);
				if (command === 'more') return true;
				pending = '';
				if (command !== 'invalid') {
					if (!(command.kind === 'motion' && 'jk'.includes(command.motion))) goal.x = undefined;
					run(view, command, goal);
				}
				return true;
			},
			decorations(state) {
				const { on, mode } = get(state);
				if (!on || mode === 'insert') return null;
				const { head, $head } = state.selection;
				const cursor =
					head < $head.end() && state.doc.textBetween(head, head + 1) !== '\n'
						? Decoration.inline(head, head + 1, { class: 'vim-cursor' })
						: Decoration.widget(head, end, { side: 1, ignoreSelection: true, key: 'vim-end' });
				const range = selection(state);
				const selected =
					range && Decoration.inline(range.from, range.to, { class: 'vim-selected' });
				return DecorationSet.create(state.doc, selected ? [selected, cursor] : [cursor]);
			},
			// the block in place of the caret, in visual mode too
			attributes: (state): Record<string, string> => {
				const { on, mode } = get(state);
				return on && mode !== 'insert' ? { class: 'vim-block' } : {};
			}
		}
	});
}

/** what v or V has selected: from where it started to the cursor, the character under it too */
function selection(state: EditorState) {
	const { mode, anchor } = get(state);
	const { head } = state.selection;
	if (mode === 'line') return lines(state, anchor, head);
	if (mode !== 'visual') return null;
	const [from, last] = [Math.min(anchor, head), Math.max(anchor, head)];
	return { from, to: Math.min(last + 1, state.doc.resolve(last).end()), line: null };
}

const end = () => {
	const span = document.createElement('span');
	span.className = 'vim-cursor vim-end';
	return span;
};

const ALIASES: Record<string, string> = { Enter: 'j', ' ': 'l', Backspace: 'h' };
const MOTIONS = 'hjklwbeWBE0^$G';

type Command =
	| { kind: 'motion'; motion: string; count: number }
	| { kind: 'operator'; op: string; target: Target; count: number }
	| { kind: 'action'; key: string; count: number; char?: string };
/** what an operator covers: a motion, its own line again (dd), or a word (iw, aw) */
type Target = { motion: string } | { line: true } | { word: 'i' | 'a'; big: boolean };

function parse(keys: string, mode: Mode): Command | 'more' | 'invalid' {
	let i = 0;
	const count = () => {
		let digits = '';
		// a 0 on its own is the start of the line
		while (i < keys.length && /\d/.test(keys[i]) && !(digits === '' && keys[i] === '0')) {
			digits += keys[i++];
		}
		return digits ? Number(digits) : 1;
	};
	const n = count();
	if (i === keys.length) return 'more';
	const key = keys[i++];
	const motion = (): Command | 'more' | 'invalid' | null => {
		if (MOTIONS.includes(key)) return { kind: 'motion', motion: key, count: n };
		if (key !== 'g') return null;
		if (i === keys.length) return 'more';
		return keys[i] === 'g' ? { kind: 'motion', motion: 'gg', count: n } : 'invalid';
	};
	const moved = motion();
	if (moved) return moved;
	if ('dcy'.includes(key) && mode === 'normal') {
		const m = count();
		if (i === keys.length) return 'more';
		const next = keys[i++];
		if (next === key) return { kind: 'operator', op: key, target: { line: true }, count: n * m };
		if (next === 'i' || next === 'a') {
			if (i === keys.length) return 'more';
			const object = keys[i];
			if (object !== 'w' && object !== 'W') return 'invalid';
			return { kind: 'operator', op: key, target: { word: next, big: object === 'W' }, count: 1 };
		}
		if (next === 'g') {
			if (i === keys.length) return 'more';
			return keys[i] === 'g'
				? { kind: 'operator', op: key, target: { motion: 'gg' }, count: 1 }
				: 'invalid';
		}
		if (!MOTIONS.includes(next)) return 'invalid';
		return { kind: 'operator', op: key, target: { motion: next }, count: n * m };
	}
	if (key === 'r') {
		if (i === keys.length) return 'more';
		return { kind: 'action', key, count: n, char: keys[i] };
	}
	return { kind: 'action', key, count: n };
}

// —— where a motion goes ——

/** The browser moving a caret from `pos`, as the arrows and Home and End would. */
function native(view: EditorView, pos: number, dir: 'forward' | 'backward', unit: string) {
	const selection = globalThis.document?.getSelection();
	if (!selection?.modify) return pos;
	try {
		const { node, offset } = view.domAtPos(pos);
		selection.collapse(node, offset);
		selection.modify('move', dir, unit);
		const { focusNode, focusOffset } = selection;
		if (!focusNode || !view.dom.contains(focusNode)) return pos;
		return view.posAtDOM(focusNode, focusOffset);
	} catch {
		return pos;
	}
}

/** a line up or down on screen, at the column it started from */
function vertical(
	view: EditorView,
	pos: number,
	dir: 'forward' | 'backward',
	goal: { x?: number }
) {
	goal.x ??= view.coordsAtPos(pos).left;
	const moved = native(view, pos, dir, 'line');
	if (moved === pos) return pos;
	const { top, bottom } = view.coordsAtPos(moved);
	return view.posAtCoords({ left: goal.x, top: (top + bottom) / 2 })?.pos ?? moved;
}

/** Every place the cursor can be, with the character after it: a block's end is a line break. */
function characters(doc: Node) {
	const out: { pos: number; ch: string }[] = [];
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		node.forEach((child, offset) => {
			const start = pos + 1 + offset;
			if (child.isText)
				for (let i = 0; i < child.text!.length; i++)
					out.push({ pos: start + i, ch: child.text![i] });
			else out.push({ pos: start, ch: '\n' });
		});
		out.push({ pos: pos + 1 + node.content.size, ch: '\n' });
		return false;
	});
	return out;
}

/** a space, a word's character, or punctuation. For W, B and E anything but a space is one */
const kind = (ch: string, big: boolean) => (/\s/.test(ch) ? 0 : big || /\w/.test(ch) ? 1 : 2);

function word(doc: Node, pos: number, motion: string) {
	const at = characters(doc);
	const big = motion === motion.toUpperCase();
	const k = (i: number) => kind(at[i].ch, big);
	const last = at.length - 1;
	let i = Math.max(
		0,
		at.findIndex((c) => c.pos >= pos)
	);
	switch (motion.toLowerCase()) {
		case 'w': {
			const start = k(i);
			if (start) while (i < last && k(i) === start) i++;
			while (i < last && k(i) === 0) i++;
			return at[i].pos;
		}
		case 'e': {
			i = Math.min(last, i + 1);
			while (i < last && k(i) === 0) i++;
			const start = k(i);
			while (i < last && k(i + 1) === start) i++;
			return at[i].pos;
		}
		default: {
			i = Math.max(0, i - 1);
			while (i > 0 && k(i) === 0) i--;
			const start = k(i);
			while (i > 0 && k(i - 1) === start) i--;
			return at[i].pos;
		}
	}
}

function move(view: EditorView, pos: number, motion: string, goal: { x?: number }) {
	const { doc } = view.state;
	switch (motion) {
		case 'h':
			return native(view, pos, 'backward', 'character');
		case 'l':
			return native(view, pos, 'forward', 'character');
		case 'j':
			return vertical(view, pos, 'forward', goal);
		case 'k':
			return vertical(view, pos, 'backward', goal);
		case '0':
		case '^':
			return native(view, pos, 'backward', 'lineboundary');
		case '$':
			// onto the line's last character, not past it
			return Math.max(pos, native(view, pos, 'forward', 'lineboundary') - 1);
		case 'gg':
			return Selection.atStart(doc).from;
		case 'G':
			return Selection.atEnd(doc).from;
		default:
			return word(doc, pos, motion);
	}
}

// —— what an operator covers ——

/**
 * The lines from `a` to `b`: lines of a code block when both are in the same one, otherwise the
 * blocks they're in. `from` and `to` are their text, `before` and `after` the blocks around it.
 */
function lines(state: EditorState, a: number, b: number) {
	const [$a, $b] = [state.doc.resolve(Math.min(a, b)), state.doc.resolve(Math.max(a, b))];
	const block = { before: $a.before(), after: $b.after() };
	if ($a.parent.type.spec.code && $a.parent === $b.parent) {
		const text = $a.parent.textContent;
		const from = text.lastIndexOf('\n', $a.parentOffset - 1) + 1;
		const stop = text.indexOf('\n', $b.parentOffset);
		const until = stop < 0 ? text.length : stop;
		const whole = from === 0 && until === text.length;
		return { ...block, from: $a.start() + from, to: $a.start() + until, code: !whole };
	}
	return { ...block, from: $a.start(), to: $b.end(), code: false };
}

/** the word around `pos`, with the spaces after it for aw */
function wordAround(doc: Node, pos: number, around: boolean, big: boolean) {
	const at = characters(doc);
	const i = at.findIndex((c) => c.pos === pos);
	if (i < 0 || at[i].ch === '\n') return null;
	const k = (j: number) => (at[j].ch === '\n' ? -1 : kind(at[j].ch, big));
	const start = k(i);
	let [s, e] = [i, i];
	while (s > 0 && k(s - 1) === start) s--;
	while (e + 1 < at.length && k(e + 1) === start) e++;
	if (around) while (e + 1 < at.length && k(e + 1) === 0) e++;
	return { from: at[s].pos, to: at[e].pos + 1 };
}

/** deletes the lines, kept for p, the cursor where they were */
function deleteLines(tr: Transaction, l: ReturnType<typeof lines>) {
	const { doc } = tr;
	if (l.code) {
		register = { kind: 'code', text: doc.textBetween(l.from, l.to) };
		const blockEnd = doc.resolve(l.to).end();
		// the line and the break after it, or before it for the last line
		tr.delete(l.to < blockEnd ? l.from : l.from - 1, l.to < blockEnd ? l.to + 1 : l.to);
	} else {
		register = { kind: 'blocks', slice: doc.slice(l.before, l.after) };
		tr.deleteRange(l.before, l.after);
	}
	return tr.setSelection(Selection.near(tr.doc.resolve(Math.min(l.from, tr.doc.content.size))));
}

function yankLines(doc: Node, l: ReturnType<typeof lines>) {
	register = l.code
		? { kind: 'code', text: doc.textBetween(l.from, l.to) }
		: { kind: 'blocks', slice: doc.slice(l.before, l.after) };
}

function operate(
	view: EditorView,
	op: string,
	from: number,
	until: number,
	then = 'normal' as Mode
) {
	const { state } = view;
	const [a, b] = [Math.min(from, until), Math.max(from, until)];
	register = { kind: 'chars', slice: state.doc.slice(a, b) };
	const tr = state.tr;
	if (op === 'y') tr.setSelection(TextSelection.create(state.doc, a));
	else tr.delete(a, b).setSelection(TextSelection.create(tr.doc, a));
	view.dispatch(to(tr.scrollIntoView(), op === 'c' ? 'insert' : then));
}

function operateLines(view: EditorView, op: string, l: ReturnType<typeof lines>) {
	const { state } = view;
	if (op === 'y') {
		yankLines(state.doc, l);
		view.dispatch(to(state.tr.setSelection(TextSelection.create(state.doc, l.from)), 'normal'));
	} else if (op === 'c') {
		// the lines emptied, the blocks they're in kept to type in
		yankLines(state.doc, l);
		const tr = state.tr.delete(l.from, l.to);
		view.dispatch(to(tr.setSelection(TextSelection.create(tr.doc, l.from)), 'insert'));
	} else {
		view.dispatch(to(deleteLines(state.tr, l).scrollIntoView(), 'normal'));
	}
}

// —— running a command ——

function run(view: EditorView, command: Command, goal: { x?: number }) {
	const { state } = view;
	const { mode, anchor } = get(state);
	const { head, $head } = state.selection;

	if (command.kind === 'motion') {
		let pos = head;
		for (let i = 0; i < command.count; i++) pos = move(view, pos, command.motion, goal);
		view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)).scrollIntoView());
		return;
	}

	if (command.kind === 'operator') {
		const { op, target } = command;
		if ('line' in target) {
			let pos = head;
			for (let i = 1; i < command.count; i++) pos = move(view, pos, 'j', goal);
			return operateLines(view, op, lines(state, head, pos));
		}
		if ('word' in target) {
			const range = wordAround(state.doc, head, target.word === 'a', target.big);
			if (range) operate(view, op, range.from, range.to);
			return;
		}
		const { motion } = target;
		// j, k, gg and G take whole lines
		if ('jk'.includes(motion) || motion === 'gg' || motion === 'G') {
			let pos = head;
			for (let i = 0; i < command.count; i++) pos = move(view, pos, motion, goal);
			return operateLines(view, op, lines(state, head, pos));
		}
		// cw is ce, as in vim
		const m = op === 'c' && motion.toLowerCase() === 'w' ? (motion === 'w' ? 'e' : 'E') : motion;
		let pos = head;
		for (let i = 0; i < command.count; i++) pos = move(view, pos, m, goal);
		// e takes the word's last character too
		if ((m.toLowerCase() === 'e' || m === '$') && pos >= head)
			pos = Math.min(pos + 1, state.doc.resolve(pos).end());
		// dw at the end of a line stops there, the next line stays where it is
		if (m.toLowerCase() === 'w' && pos > $head.end()) pos = $head.end();
		if (pos !== head) operate(view, op, head, pos);
		return;
	}

	const { key, count } = command;
	const tr = state.tr;
	const cursor = (pos: number, next: Mode = 'normal') =>
		view.dispatch(to(tr.setSelection(TextSelection.create(tr.doc, pos)).scrollIntoView(), next));
	const line = lines(state, head, head);

	// v and V: what's selected
	if (mode === 'visual' || mode === 'line') {
		const range = selection(state)!;
		if ('dxs'.includes(key) || key === 'c' || key === 'y') {
			const op = key === 'x' ? 'd' : key === 's' ? 'c' : key;
			if (mode === 'line') return operateLines(view, op, lines(state, anchor, head));
			return operate(view, op, range.from, range.to);
		}
		if (key === 'p' && register) {
			if (register.kind === 'code') tr.insertText(register.text, range.from, range.to);
			else tr.replaceRange(range.from, range.to, register.slice);
			return cursor(tr.mapping.map(range.to));
		}
		// the other v or V switches to it from the same start, the same one ends it
		if (key === 'v' || key === 'V') {
			const next = key === 'v' ? 'visual' : 'line';
			return view.dispatch(to(tr, next === mode ? 'normal' : next, anchor));
		}
		return;
	}

	switch (key) {
		case 'i':
			return cursor(head, 'insert');
		case 'a':
			return cursor(head < $head.end() ? head + 1 : head, 'insert');
		case 'I':
			return cursor(line.from, 'insert');
		case 'A':
			return cursor(line.to, 'insert');
		case 'o':
		case 'O': {
			const below = key === 'o';
			if (line.code || $head.parent.type.spec.code) {
				const at = below ? line.to : line.from;
				tr.insertText('\n', at);
				return cursor(below ? at + 1 : at, 'insert');
			}
			// in a list, a new item
			const item = $head.depth > 1 && $head.node(-1).type.name === 'list_item' ? -1 : 0;
			const at = item
				? below
					? $head.after(-1)
					: $head.before(-1)
				: below
					? line.after
					: line.before;
			const { list_item, paragraph } = state.schema.nodes;
			const node = item ? list_item.create(null, paragraph.create()) : paragraph.create();
			tr.insert(at, node);
			return cursor(at + (item ? 2 : 1), 'insert');
		}
		case 'x':
		case 's': {
			const until = Math.min(head + count, $head.end());
			if (until > head) return operate(view, key === 's' ? 'c' : 'd', head, until);
			return key === 's' ? cursor(head, 'insert') : undefined;
		}
		case 'X': {
			const from = Math.max(head - count, $head.start());
			if (from < head) operate(view, 'd', from, head);
			return;
		}
		case 'D':
		case 'C': {
			const until = Math.min(move(view, head, '$', goal) + 1, $head.end());
			if (until > head) return operate(view, key === 'D' ? 'd' : 'c', head, until);
			return key === 'C' ? cursor(head, 'insert') : undefined;
		}
		case 'S':
			return operateLines(view, 'c', line);
		case 'Y':
			return yankLines(state.doc, line);
		case 'r': {
			const until = head + count;
			if (until > $head.end() || state.doc.textBetween(head, until).includes('\n')) return;
			tr.insertText(command.char!.repeat(count), head, until);
			return cursor(until - 1);
		}
		case 'p':
		case 'P': {
			if (!register) return;
			const after = key === 'p';
			if (register.kind === 'code' && $head.parent.type.spec.code) {
				const text = register.text;
				if (after) tr.insertText(`\n${text}`, line.to);
				else tr.insertText(`${text}\n`, line.from);
				return cursor(after ? line.to + 1 : line.from);
			}
			if (register.kind === 'chars') {
				const at = after && head < $head.end() ? head + 1 : head;
				tr.replace(at, at, register.slice);
				return cursor(Math.max(at, tr.mapping.map(at, 1) - 1));
			}
			// whole blocks go between blocks, a code line outside code as a paragraph of its own
			const at = after ? line.after : line.before;
			const content =
				register.kind === 'code'
					? state.schema.nodes.paragraph.create(
							null,
							register.text ? state.schema.text(register.text) : null
						)
					: register.slice.content;
			tr.insert(at, content);
			return cursor(Selection.near(tr.doc.resolve(at + 1)).from);
		}
		case 'u':
			for (let i = 0; i < count; i++) undo(view.state, view.dispatch);
			return;
		case '\x12':
			for (let i = 0; i < count; i++) redo(view.state, view.dispatch);
			return;
		case 'v':
			return view.dispatch(to(tr, 'visual', head));
		case 'V':
			return view.dispatch(to(tr, 'line', head));
	}
}
