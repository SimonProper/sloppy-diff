import MarkdownIt from 'markdown-it';
import { Fragment, Schema, Slice, type Node, type MarkType } from 'prosemirror-model';
import { EditorState, Plugin, Selection, TextSelection, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
	MarkdownParser,
	MarkdownSerializer,
	defaultMarkdownParser,
	defaultMarkdownSerializer,
	schema as markdownSchema
} from 'prosemirror-markdown';
import {
	InputRule,
	inputRules,
	textblockTypeInputRule,
	undoInputRule,
	wrappingInputRule
} from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import {
	baseKeymap,
	chainCommands,
	exitCode,
	setBlockType,
	toggleMark
} from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';

/**
 * The fields questions and comments are typed in: rich text that is markdown underneath,
 * read in with markdown-it as answers are rendered and written back out for Claude and
 * GitHub. No images, as the renderer has none: one pasted in would load from wherever.
 */
export const schema = new Schema({
	nodes: markdownSchema.spec.nodes
		.update('image', { ...markdownSchema.spec.nodes.get('image')!, parseDOM: [] })
		// GitHub's task lists: `- [ ] ` and `- [x] `, null for an item that isn't a task
		.update('list_item', {
			...markdownSchema.spec.nodes.get('list_item')!,
			attrs: { checked: { default: null } },
			parseDOM: [
				{
					tag: 'li',
					getAttrs: (li) => ({ checked: taskState(li.getAttribute('data-checked')) })
				}
			],
			toDOM: (node) => [
				'li',
				node.attrs.checked === null ? {} : { 'data-checked': String(node.attrs.checked) },
				0
			]
		}),
	marks: markdownSchema.spec.marks.addToEnd('strike', {
		parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
		toDOM: () => ['s', 0]
	})
});

function taskState(checked: string | null) {
	return checked === null ? null : checked === 'true';
}

// ours is markdown-it 15 and prosemirror-markdown is typed against 14, the same at runtime
const md = new MarkdownIt('commonmark', { html: false }).disable('image').enable('strikethrough');

// `[ ] ` or `[x] ` opening a list item makes it a task, read off the item's text
md.core.ruler.after('inline', 'tasks', (state) => {
	const tokens = state.tokens;
	for (let i = 2; i < tokens.length; i++) {
		const [item, open, inline] = [tokens[i - 2], tokens[i - 1], tokens[i]];
		if (item.type !== 'list_item_open' || open.type !== 'paragraph_open') continue;
		const first = inline.children?.[0];
		const box = first?.type === 'text' && /^\[([ xX])\] /.exec(first.content);
		if (!box) continue;
		item.attrSet('data-checked', String(box[1] !== ' '));
		first.content = first.content.slice(box[0].length);
	}
	return false;
});

const parser = new MarkdownParser(schema, md as unknown as MarkdownParser['tokenizer'], {
	...defaultMarkdownParser.tokens,
	list_item: {
		block: 'list_item',
		getAttrs: (token) => ({ checked: taskState(token.attrGet('data-checked')) })
	},
	s: { mark: 'strike' },
	// a line break typed in the old plain field, or a draft kept from it, stays one
	softbreak: { node: 'hard_break' }
});

const serializer = new MarkdownSerializer(
	{
		...defaultMarkdownSerializer.nodes,
		list_item(state, node) {
			if (node.attrs.checked !== null) state.write(node.attrs.checked ? '[x] ' : '[ ] ');
			state.renderContent(node);
		}
	},
	{
		...defaultMarkdownSerializer.marks,
		strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true }
	}
);

export const parse = (markdown: string): Node => parser.parse(markdown);
export const serialize = (doc: Node): string => serializer.serialize(doc);

/** A path's extension, what a fence names its language by: `ts` for `src/a.ts`. */
export function extensionOf(path: string | undefined) {
	const name = path?.split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1) : '';
}

const { nodes, marks } = schema;

/**
 * `**bold**`, `*em*` and `` `code` `` as the closing mark is typed, the marks dropped.
 * The pattern's groups are the opening mark and the text; the last character it matches
 * is the one being typed, not in the document yet.
 */
function markRule(pattern: RegExp, type: MarkType) {
	return new InputRule(pattern, (state, [, open, text], _start, end) => {
		const textEnd = end - (open.length - 1);
		const from = textEnd - text.length - open.length;
		return state.tr
			.delete(textEnd, end)
			.delete(from, from + open.length)
			.addMark(from, from + text.length, type.create())
			.removeStoredMark(type);
	});
}

/**
 * ``` starts a code block, ```ts one in that language, on a space or ↵. Without one it's
 * in the language of the lines it's about, given.
 */
const FENCE = /^```([\w+#-]*)\s$/;
const fenceAttrs = (match: RegExpMatchArray, language?: () => string | undefined) => ({
	params: match[1] || language?.() || ''
});

/** `[ ] ` or `[x] ` at the start of a list item makes it a task */
const taskRule = new InputRule(/^\[([ x]?)\]\s$/, (state, match, start, end) => {
	const $start = state.doc.resolve(start);
	if ($start.depth < 2) return null;
	const item = $start.node(-1);
	if (item.type !== nodes.list_item || $start.index(-1) !== 0) return null;
	return state.tr
		.delete(start, end)
		.setNodeMarkup($start.before(-1), null, { checked: match[1] === 'x' });
});

const rules = (language?: () => string | undefined) =>
	inputRules({
		rules: [
			textblockTypeInputRule(FENCE, nodes.code_block, (m) => fenceAttrs(m, language)),
			taskRule,
			textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading, (m) => ({ level: m[1].length })),
			wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
			wrappingInputRule(/^\s*[-*]\s$/, nodes.bullet_list, { tight: true }),
			wrappingInputRule(
				/^(\d+)\.\s$/,
				nodes.ordered_list,
				(m) => ({ order: +m[1], tight: true }),
				(m, node) => node.childCount + node.attrs.order === +m[1]
			),
			markRule(/(\*\*)([^*]+)\*\*$/, marks.strong),
			// not across spaces at either end, so 2 * 3 * 4 stays as it is
			markRule(/(?:^|[^*])(\*)([^*\s](?:[^*]*[^*\s])?)\*$/, marks.em),
			markRule(/(`)([^`]+)`$/, marks.code),
			markRule(/(~~)([^~]+)~~$/, marks.strike)
		]
	});

/** ↵ on a line that's only a fence: the rule above waits for a space */
const fenceOnEnter =
	(language?: () => string | undefined): Command =>
	(state, dispatch) => {
		const { $from, empty } = state.selection;
		const line = $from.parent;
		if (!empty || line.type !== nodes.paragraph || $from.parentOffset !== line.content.size) {
			return false;
		}
		const match = /^```([\w+#-]*)$/.exec(line.textContent);
		if (!match) return false;
		if (dispatch) {
			const start = $from.start();
			const tr = state.tr.delete(start, $from.pos);
			dispatch(tr.setBlockType(start, start, nodes.code_block, fenceAttrs(match, language)));
		}
		return true;
	};

/** ↵ on an empty last line of a code block leaves it, as in most editors */
const leaveCode: Command = (state, dispatch) => {
	const { $from, empty } = state.selection;
	const block = $from.parent;
	if (!empty || block.type !== nodes.code_block) return false;
	if ($from.parentOffset !== block.content.size || !block.textContent.endsWith('\n')) {
		return false;
	}
	if (dispatch) {
		const tr = state.tr.delete($from.pos - 1, $from.pos);
		const after = tr.mapping.map($from.after());
		// into the empty line kept below the last block, or a new one
		const next = tr.doc.nodeAt(after);
		if (next?.type !== nodes.paragraph || next.content.size)
			tr.insert(after, nodes.paragraph.create());
		dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
	}
	return true;
};

/**
 * ↑ or ← at the very start of a code block, list or quote that opens the field: a line
 * above it, to write before a suggestion as well as after it.
 */
const lineAbove: Command = (state, dispatch) => {
	const { $from, empty } = state.selection;
	if (!empty || state.doc.firstChild?.type === nodes.paragraph) return false;
	if ($from.pos !== Selection.atStart(state.doc).from) return false;
	if (dispatch) {
		const tr = state.tr.insert(0, nodes.paragraph.create());
		dispatch(tr.setSelection(TextSelection.create(tr.doc, 1)).scrollIntoView());
	}
	return true;
};

/** The empty line a block that ends the field keeps after it, to go on writing below it. */
const needsLineBelow = (doc: Node) => doc.lastChild?.type !== nodes.paragraph;
const lineBelow = new Plugin({
	appendTransaction: (_, __, state) =>
		needsLineBelow(state.doc)
			? state.tr.insert(state.doc.content.size, nodes.paragraph.create())
			: null
});

/** ⌫ at the start of a code block or heading makes it a paragraph again */
const unblock: Command = (state, dispatch) => {
	const { $from, empty } = state.selection;
	const type = $from.parent.type;
	if (!empty || $from.parentOffset > 0) return false;
	if (type !== nodes.code_block && type !== nodes.heading) return false;
	return setBlockType(nodes.paragraph)(state, dispatch);
};

export interface Options {
	/** ⌘↵ */
	send: () => void;
	/** Tab outside a list, given */
	tab?: () => boolean;
	/** colours for code typed in a fence */
	tokens: Tokens;
	/** the extension of the file it's about, for a fence that names no language */
	language?: () => string | undefined;
}

function keys({ send, tab, language }: Options) {
	return keymap({
		'Mod-Enter': () => (send(), true),
		Enter: chainCommands(fenceOnEnter(language), leaveCode, splitListItem(nodes.list_item)),
		'Shift-Enter': chainCommands(exitCode, (state, dispatch) => {
			dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView());
			return true;
		}),
		Tab: chainCommands(sinkListItem(nodes.list_item), () => tab?.() ?? false),
		'Shift-Tab': liftListItem(nodes.list_item),
		Backspace: chainCommands(undoInputRule, unblock),
		ArrowUp: lineAbove,
		ArrowLeft: lineAbove,
		'Mod-z': undo,
		'Shift-Mod-z': redo,
		'Mod-y': redo,
		'Mod-b': toggleMark(marks.strong),
		'Mod-i': toggleMark(marks.em),
		'Mod-e': toggleMark(marks.code),
		'Mod-Shift-x': toggleMark(marks.strike)
	});
}

/** A task's box, drawn before its item, ticks and unticks it. */
const tasks = new Plugin({
	props: {
		handleClickOn(view, _pos, node, at, event, direct) {
			if (!direct || node.type !== nodes.list_item || node.attrs.checked === null) return false;
			// on the item itself, not its text: the box, drawn to the left of it
			if (!(event.target as HTMLElement).matches('li')) return false;
			view.dispatch(view.state.tr.setNodeMarkup(at, null, { checked: !node.attrs.checked }));
			return true;
		}
	}
});

/** Marks the field empty, for the placeholder drawn over it. */
const emptiness = new Plugin({
	props: {
		attributes: (state): Record<string, string> =>
			state.doc.childCount === 1 &&
			state.doc.firstChild!.type === nodes.paragraph &&
			state.doc.firstChild!.content.size === 0
				? { 'data-empty': '' }
				: {}
	}
});

// lines copied from a diff on this page, to paste them as code in their file's language
let copied: { text: string; lang: string } | null = null;
let listening = false;
const squash = (text: string) => text.replace(/\s+/g, '');

function listenForCopies() {
	if (listening || typeof document === 'undefined') return;
	listening = true;
	document.addEventListener('copy', () => {
		const selection = document.getSelection();
		const code = selection?.anchorNode?.parentElement?.closest('.twinkleplop');
		const path = code?.closest('section[data-path]')?.getAttribute('data-path');
		copied = selection && path ? { text: selection.toString(), lang: extensionOf(path) } : null;
	});
}

/** Code, from the diff or VS Code, pasted as code: a block for lines, a span for less. */
function pastedCode(text: string, data: DataTransfer): { lang: string } | null {
	if (copied && squash(copied.text) === squash(text)) return copied;
	const vscode = data.getData('vscode-editor-data');
	if (!vscode) return null;
	try {
		const mode = JSON.parse(vscode).mode;
		return { lang: typeof mode === 'string' && mode !== 'plaintext' ? mode : '' };
	} catch {
		return { lang: '' };
	}
}

/**
 * Pasting: plain text read as markdown, code from the diff or an editor as code, a link
 * over selected words linking them. Copying out gives markdown, code as it is.
 */
const clipboard = new Plugin({
	view() {
		listenForCopies();
		return {};
	},
	props: {
		handlePaste(view, event) {
			const { state } = view;
			const { $from, from, to, empty } = state.selection;
			const data = event.clipboardData;
			const text = data?.getData('text/plain').replace(/\r\n?/g, '\n') ?? '';
			if (!data || !text.trim() || $from.parent.type.spec.code) return false;
			if (!empty && /^https?:\/\/\S+$/.test(text.trim())) {
				view.dispatch(state.tr.addMark(from, to, marks.link.create({ href: text.trim() })));
				return true;
			}
			const code = pastedCode(text, data);
			if (!code) return false;
			const lines = text.replace(/\n+$/, '');
			const tr = lines.includes('\n')
				? state.tr.replaceSelectionWith(
						nodes.code_block.create({ params: code.lang }, schema.text(lines))
					)
				: state.tr.replaceSelectionWith(schema.text(lines.trim(), [marks.code.create()]), false);
			view.dispatch(tr.scrollIntoView());
			return true;
		},
		// ⇧ pastes it as it is, a paragraph a line, its markdown kept as text
		clipboardTextParser(text, _context, plain) {
			const content = plain
				? Fragment.from(
						text
							.split(/\n+/)
							.map((line) => nodes.paragraph.create(null, line ? schema.text(line) : null))
					)
				: parse(text).content;
			return Slice.maxOpen(content);
		},
		clipboardTextSerializer(slice) {
			const only = slice.content.childCount === 1 ? slice.content.firstChild! : null;
			if (only?.type === nodes.code_block) return only.textContent;
			const doc = schema.topNodeType.createAndFill(null, slice.content);
			return doc ? serialize(doc) : slice.content.textBetween(0, slice.content.size, '\n\n');
		}
	}
});

export type Tokens = (lang: string, text: string) => Promise<[number, number, string][]>;

export function createState(markdown: string, options: Options) {
	const doc = parse(markdown);
	return EditorState.create({
		doc: needsLineBelow(doc) ? doc.copy(doc.content.addToEnd(nodes.paragraph.create())) : doc,
		plugins: [
			rules(options.language),
			keys(options),
			keymap(baseKeymap),
			history(),
			clipboard,
			lineBelow,
			emptiness,
			tasks,
			codeColours(options.tokens)
		]
	});
}

// one highlight per token type, shared by every field on the page. Each field adds its
// own ranges to them and takes them out again
const painted = new Map<string, Highlight>();

function highlight(type: string) {
	let h = painted.get(type);
	if (!h) {
		painted.set(type, (h = new Highlight()));
		CSS.highlights.set(`twp-${type}`, h);
	}
	return h;
}

/** The code blocks' text coloured by the diff's grammars, asked of the server as it's typed. */
function codeColours(tokens: Tokens) {
	return new Plugin({
		view(view) {
			if (typeof CSS === 'undefined' || !('highlights' in CSS)) return {};
			let ranges: [Highlight, Range][] = [];
			let timer: ReturnType<typeof setTimeout> | undefined;

			const clear = () => {
				for (const [h, range] of ranges) h.delete(range);
				ranges = [];
			};

			async function paint() {
				const doc = view.state.doc;
				const blocks: { pos: number; lang: string; text: string }[] = [];
				doc.descendants((node, pos) => {
					if (node.type !== nodes.code_block) return true;
					const lang = node.attrs.params.trim().split(/\s/)[0];
					if (lang && node.textContent) blocks.push({ pos, lang, text: node.textContent });
					return false;
				});
				const found = await Promise.all(blocks.map((b) => tokens(b.lang, b.text).catch(() => [])));
				// typed on meanwhile: the next paint has it
				if (view.isDestroyed || view.state.doc !== doc) return;
				clear();
				blocks.forEach((block, i) => {
					const dom = view.nodeDOM(block.pos);
					if (!(dom instanceof HTMLElement)) return;
					for (const [start, end, type] of found[i]) {
						const range = textRange(dom, start, end);
						if (range) ranges.push([highlight(type), range]);
					}
				});
				for (const [h, range] of ranges) h.add(range);
			}

			const schedule = () => {
				clearTimeout(timer);
				timer = setTimeout(paint, 120);
			};
			schedule();
			return {
				update: (view: EditorView, before: EditorState) => {
					if (!before.doc.eq(view.state.doc)) schedule();
				},
				destroy: () => {
					clearTimeout(timer);
					clear();
				}
			};
		}
	});
}

/** The DOM range of characters `start` to `end` of the text in `root`. */
function textRange(root: HTMLElement, start: number, end: number): Range | null {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const range = document.createRange();
	let offset = 0;
	let started = false;
	for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
		const next = offset + text.length;
		if (!started && start <= next) {
			range.setStart(text, start - offset);
			started = true;
		}
		if (started && end <= next) {
			range.setEnd(text, end - offset);
			return range;
		}
		offset = next;
	}
	return null;
}
