import { expect, test } from 'vitest';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { firstLine } from '$lib/markdown';
import { createState, parse, serialize } from './editor';
import { insertMention, mentionAt, mentionsFor } from './mentions';

/** Types into a field as the browser would, each key through the editor's plugins. */
function field(markdown = '', language?: string) {
	let sent = 0;
	const view = {
		composing: false,
		state: createState(markdown, {
			send: () => sent++,
			tokens: async () => [],
			language: () => language
		}) as EditorState,
		dispatch(tr: Transaction) {
			view.state = view.state.apply(tr);
		}
	};
	const ed = view as unknown as EditorView;
	const plugins = () => view.state.plugins;
	return {
		type(text: string) {
			for (const ch of text) {
				const { from, to } = view.state.selection;
				const handled = plugins().some((p) =>
					p.props.handleTextInput?.call(p, ed, from, to, ch, () => view.state.tr)
				);
				if (!handled) view.dispatch(view.state.tr.insertText(ch));
			}
		},
		press(key: string, mods: Partial<KeyboardEvent> = {}) {
			const event = { key, preventDefault() {}, ...mods } as KeyboardEvent;
			plugins().some((p) => p.props.handleKeyDown?.call(p, ed, event));
		},
		/** as the browser hands a paste to the editor, its own parser after the plugins' */
		paste(data: Record<string, string>) {
			const clipboardData = { getData: (type: string) => data[type] ?? '' };
			const event = { clipboardData } as unknown as ClipboardEvent;
			if (plugins().some((p) => p.props.handlePaste?.call(p, ed, event, null as never))) return;
			const parser = plugins().find((p) => p.props.clipboardTextParser)!.props;
			const slice = parser.clipboardTextParser!.call(
				parser as never,
				data['text/plain'],
				view.state.selection.$from,
				false,
				ed
			);
			view.dispatch(view.state.tr.replaceSelection(slice));
		},
		select(from: number, to: number) {
			view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
		},
		copy() {
			const props = plugins().find((p) => p.props.clipboardTextSerializer)!.props;
			return props.clipboardTextSerializer!.call(props as never, view.state.doc.slice(0), ed);
		},
		get state() {
			return view.state;
		},
		apply(tr: Transaction) {
			view.dispatch(tr);
		},
		get doc() {
			return view.state.doc;
		},
		get markdown() {
			return serialize(view.state.doc);
		},
		get sent() {
			return sent;
		}
	};
}

test('markdown goes through unchanged, a single line break kept as one', () => {
	const fenced = '```ts\nconst a_b = 1\n```';
	expect(serialize(parse(fenced))).toBe(fenced);
	expect(serialize(parse('snake_case and `code`'))).toBe('snake_case and `code`');
	expect(serialize(parse('one\ntwo'))).toBe('one\\\ntwo');
	expect(serialize(parse('![x](https://x.test/a.png)'))).not.toContain('<img');
});

test('typed markdown becomes formatting', () => {
	const f = field();
	f.type('**bold** and *em* and `code`, but 2 * 3 * 4');
	expect(f.markdown).toBe('**bold** and *em* and `code`, but 2 \\* 3 \\* 4');

	const list = field();
	list.type('- one');
	list.press('Enter');
	list.type('two');
	expect(list.markdown).toBe('* one\n* two');
});

test('a fence starts a code block and ↵ on an empty last line leaves it', () => {
	const f = field();
	f.type('```ts');
	f.press('Enter');
	f.type('let a');
	f.press('Enter');
	f.press('Enter');
	f.type('after');
	expect(f.markdown).toBe('```ts\nlet a\n```\n\nafter');
});

test('⌘↵ sends', () => {
	const f = field('hi');
	f.press('Enter', { metaKey: true });
	expect(f.sent).toBe(1);
});

test('a title is the first line without the escapes', () => {
	expect(firstLine(serialize(parse('Why *2 \\* 3*?\nmore')))).toBe('Why *2 * 3*?');
});

test('pasted text is read as markdown, code from an editor as code', () => {
	const f = field();
	f.paste({ 'text/plain': '**b** and `c`\n\n- one' });
	expect(f.markdown).toBe('**b** and `c`\n\n* one');

	const code = field();
	const vscode = JSON.stringify({ mode: 'typescript' });
	code.paste({ 'text/plain': 'let a = 1\nlet b = 2\n', 'vscode-editor-data': vscode });
	expect(code.markdown).toBe('```typescript\nlet a = 1\nlet b = 2\n```');

	const word = field();
	word.paste({ 'text/plain': 'total', 'vscode-editor-data': vscode });
	expect(word.markdown).toBe('`total`');
});

test('a link pasted over words links them', () => {
	const f = field('see the docs');
	f.select(5, 13);
	f.paste({ 'text/plain': 'https://x.test/a' });
	expect(f.markdown).toBe('see [the docs](https://x.test/a)');
});

test('copied out as markdown', () => {
	expect(field('**b** and `c`').copy()).toBe('**b** and `c`');
});

test('a suggestion can have text before and after it, the empty lines not sent', () => {
	const f = field('```suggestion\nlet a\n```');
	f.select(1, 1);
	f.press('ArrowUp');
	f.type('Rename it:');
	expect(f.markdown.trim()).toBe('Rename it:\n\n```suggestion\nlet a\n```');
	expect(field('```ts\nlet a\n```').markdown.trim()).toBe('```ts\nlet a\n```');
});

test('a block typed at the end gets an empty line after it', () => {
	const f = field();
	f.type('```ts ');
	expect(f.doc.childCount).toBe(2);
	expect(f.doc.lastChild!.type.name).toBe('paragraph');
});

test("a fence without a language takes the file's", () => {
	const f = field('', 'ts');
	f.type('``` ');
	f.type('let a');
	expect(f.markdown.trim()).toBe('```ts\nlet a\n```');
	const named = field('', 'ts');
	named.type('```py ');
	expect(named.doc.firstChild!.attrs.params).toBe('py');
});

test('strikethrough and task lists go through as GitHub writes them', () => {
	const tasks = '* [ ] open\n* [x] done\n* plain';
	expect(serialize(parse(tasks))).toBe(tasks);
	expect(serialize(parse('~~gone~~ and \\[ \\] not a task'))).toBe(
		'~~gone~~ and \\[ \\] not a task'
	);

	const f = field();
	f.type('- [ ] write tests and ~~skip~~');
	expect(f.markdown.trim()).toBe('* [ ] write tests and ~~skip~~');
});

test("@ offers the diff's files and the pull request's people, and puts one in", () => {
	const offered = {
		files: ['src/lib/cart.ts', 'src/routes/+page.svelte'],
		people: ['carla', 'sam']
	};
	expect(mentionsFor('ca', offered).map((m) => m.text)).toEqual(['@carla', 'src/lib/cart.ts']);
	expect(mentionsFor('routes', offered).map((m) => m.text)).toEqual(['src/routes/+page.svelte']);

	const f = field();
	f.type('see @ca');
	const at = mentionAt(f.state)!;
	expect(at.query).toBe('ca');
	f.apply(insertMention(f.state, at.from, mentionsFor('ca', offered)[1]));
	f.type('now');
	expect(f.markdown.trim()).toBe('see `src/lib/cart.ts` now');
	expect(mentionAt(field('`a @b`').state)).toBeNull();
});
