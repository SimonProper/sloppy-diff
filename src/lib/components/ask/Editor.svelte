<script lang="ts">
	import { untrack } from 'svelte';
	import { Selection } from 'prosemirror-state';
	import { EditorView } from 'prosemirror-view';
	import 'prosemirror-view/style/prosemirror.css';
	import { createState, parse, serialize } from '$lib/ask/editor';
	import { codeTokens } from '$lib/ask/ask.remote';
	import { getMentions, insertMention, mentionAt, mentionsFor } from '$lib/ask/mentions';
	import { modeOf, setVim, vimEscape } from '$lib/ask/vim';
	import { vimKeys } from '$lib/vim.svelte';

	interface Props {
		/** markdown, what's sent */
		value: string;
		placeholder: string;
		/** the extension of the file it's about: a fence's language when it names none, and a
		 * ```suggestion's */
		language?: string;
		/** ⌘↵ */
		onsend: () => void;
		/** Tab outside a list, to switch what send does */
		ontab?: () => void;
		onescape?: () => void;
		/** `@` offers the pull request's people as well as the diff's files: a comment on it */
		people?: boolean;
		autofocus?: boolean;
		class?: string;
	}

	let {
		value = $bindable(),
		placeholder,
		language,
		onsend,
		ontab,
		onescape,
		people = false,
		autofocus = false,
		class: className = ''
	}: Props = $props();

	let view = $state.raw<EditorView>();
	// the markdown last written out, to tell a change made outside from one typed here
	let written = value;

	// `@` and what's typed after it, offering what to put in its place
	const mentionable = getMentions();
	let mention = $state<{
		from: number;
		query: string;
		left: number;
		/** under the line, or over it where there's no room under it */
		top: number | null;
		bottom: number | null;
	} | null>(null);
	let picked = $state(0);
	// where the menu was put away with esc, so it stays away for that `@`
	let dismissed = -1;
	const offered = $derived.by(() => {
		const all = mention && mentionable?.();
		if (!all) return [];
		return mentionsFor(mention!.query, people ? all : { ...all, people: [] });
	});

	function track(editor: EditorView) {
		// only while typing, not with vim's cursor resting after an `@`
		const typing = editor.hasFocus() && modeOf(editor.state) === 'insert';
		const at = typing ? mentionAt(editor.state) : null;
		if (!at) dismissed = -1;
		if (!at || at.from === dismissed) {
			mention = null;
			return;
		}
		if (at.query !== mention?.query) picked = 0;
		const { top, bottom, left } = editor.coordsAtPos(at.from);
		const under = window.innerHeight - bottom > 280;
		mention = {
			...at,
			left: Math.max(8, Math.min(left, window.innerWidth - 288 - 8)),
			top: under ? bottom + 4 : null,
			bottom: under ? null : window.innerHeight - top + 4
		};
	}

	function pick(editor: EditorView, index: number) {
		if (!mention || !offered[index]) return;
		editor.dispatch(insertMention(editor.state, mention.from, offered[index]));
	}

	/** ↑ ↓ to choose, ↵ or tab to put it in, esc to put the menu away */
	function onMenuKey(editor: EditorView, event: KeyboardEvent) {
		if (!mention || !offered.length) return false;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			const step = event.key === 'ArrowDown' ? 1 : -1;
			picked = (picked + step + offered.length) % offered.length;
		} else if ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || event.key === 'Tab') {
			pick(editor, picked);
		} else if (event.key === 'Escape') {
			event.stopPropagation();
			dismissed = mention.from;
			mention = null;
		} else return false;
		return true;
	}

	$effect(() => {
		view?.setProps({ attributes: { 'data-placeholder': placeholder, 'aria-label': placeholder } });
	});

	// cleared after a send, or lines' text added from the diff
	$effect(() => {
		if (!view || value === written) return;
		written = value;
		const { tr, doc } = view.state;
		tr.replaceWith(0, doc.content.size, parse(value).content);
		// at the end, where text added from outside goes, typing again after a send
		view.dispatch(setVim(tr.setSelection(Selection.atEnd(tr.doc)).scrollIntoView(), vimKeys.on));
	});

	// vim's keys switched in the View menu
	$effect(() => {
		const on = vimKeys.on;
		untrack(() => view && view.dispatch(setVim(view.state.tr, on)));
	});
</script>

<div
	class={['editor prose', className]}
	{@attach (el) =>
		// made once: what's typed reaches it through dispatch, not by making it again
		untrack(() => {
			const state = createState(value, {
				send: () => onsend(),
				tab: () => !!ontab && (ontab(), true),
				// a ```suggestion is in the language of the lines it changes
				tokens: (lang, text) =>
					codeTokens({ lang: lang === 'suggestion' ? (language ?? '') : lang, text }),
				language: () => language,
				vim: vimKeys.on
			});
			const editor = new EditorView(el, {
				state,
				attributes: { 'data-placeholder': placeholder, 'aria-label': placeholder },
				handleKeyDown: (editor, event) => {
					if (onMenuKey(editor, event)) return true;
					if (event.key !== 'Escape') return false;
					// vim: from typing to normal mode first, the next one closes
					if (vimEscape(editor)) {
						event.stopPropagation();
						return true;
					}
					if (!onescape) return false;
					event.stopPropagation();
					onescape();
					return true;
				},
				dispatchTransaction(tr) {
					editor.updateState(editor.state.apply(tr));
					if (tr.docChanged) value = written = serialize(editor.state.doc);
					track(editor);
				},
				handleDOMEvents: {
					blur: () => ((mention = null), false)
				}
			});
			view = editor;
			// after the popover it may sit in has opened, a hidden field can't take focus
			const frame = autofocus ? requestAnimationFrame(() => editor.focus()) : 0;
			return () => {
				cancelAnimationFrame(frame);
				editor.destroy();
				view = undefined;
			};
		})}
></div>

{#if mention && offered.length && view}
	{@const editor = view}
	<!-- on the top layer, above the popover or panel the field is in -->
	<div
		popover="manual"
		{@attach (el) => {
			el.showPopover();
			return () => el.hidePopover();
		}}
		class="fixed m-0 w-72 overflow-hidden rounded-lg border border-line bg-surface p-1 text-[12.5px] shadow-float"
		style:top={mention.top === null ? 'auto' : `${mention.top}px`}
		style:bottom={mention.bottom === null ? 'auto' : `${mention.bottom}px`}
		style:left="{mention.left}px"
		role="listbox"
		aria-label="Mention"
	>
		{#each offered as item, i (item.text)}
			<button
				type="button"
				role="option"
				aria-selected={i === picked}
				class={[
					'flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left',
					i === picked ? 'bg-subtle text-fg' : 'text-muted'
				]}
				onpointerdown={(event) => event.preventDefault()}
				onpointerenter={() => (picked = i)}
				onclick={() => pick(editor, i)}
			>
				<span class={['shrink-0', item.kind === 'file' && 'font-mono']}>{item.label}</span>
				{#if item.detail}
					<span class="min-w-0 truncate font-mono text-[11px] text-faint">{item.detail}</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	.editor :global(.ProseMirror) {
		position: relative;
		outline: none;
	}
	.editor :global(.ProseMirror[data-empty]::before) {
		content: attr(data-placeholder);
		position: absolute;
		pointer-events: none;
		color: color-mix(in oklab, var(--fg) 50%, transparent);
	}
	.editor :global(:is(h1, h2, h3)) {
		font-weight: 600;
		margin-top: 0.5em;
	}
	.editor :global(:is(h1, h2, h3):first-child) {
		margin-top: 0;
	}
	.editor :global(pre) {
		font-family: var(--font-mono);
		font-size: 0.88em;
		white-space: pre-wrap;
	}
	/* a task's box, drawn before its item: clicking it ticks it */
	.editor :global(li[data-checked]) {
		position: relative;
		list-style: none;
	}
	.editor :global(li[data-checked]::before) {
		content: '';
		position: absolute;
		top: 0.3em;
		left: -1.2em;
		width: 0.85em;
		height: 0.85em;
		border: 1.5px solid var(--muted);
		border-radius: var(--radius-xs);
		cursor: pointer;
	}
	.editor :global(li[data-checked='true']::before) {
		content: '✓';
		display: grid;
		place-items: center;
		font-size: 0.7em;
		font-weight: 700;
		border-color: var(--fg);
		background: var(--fg);
		color: var(--surface);
	}
	.editor :global(a) {
		text-decoration: underline;
	}
	/* vim's normal mode: a block on the character the cursor is on, hollow when it's elsewhere */
	.editor :global(.vim-normal) {
		caret-color: transparent;
	}
	.editor :global(.vim-cursor) {
		border-radius: 1px;
		background: color-mix(in oklab, var(--fg) 35%, transparent);
	}
	.editor :global(.vim-end) {
		display: inline-block;
		width: 0.6em;
		height: 1.2em;
		vertical-align: text-bottom;
	}
	.editor :global(.ProseMirror:not(:focus) .vim-cursor) {
		background: none;
		outline: 1px solid color-mix(in oklab, var(--fg) 50%, transparent);
		outline-offset: -1px;
	}
</style>
