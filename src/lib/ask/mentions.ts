import { getContext, setContext } from 'svelte';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { PullRequest } from '$lib/pr/types';
import { schema } from './editor';

/** What a field offers after `@`: the diff's files, and on a pull request the people on it. */
export interface Mentionable {
	files: string[];
	people: string[];
}

export interface Mention {
	kind: 'file' | 'person';
	label: string;
	/** the file's folder */
	detail?: string;
	/** what goes in its place: the path, or `@login` */
	text: string;
}

const key = Symbol('mentions');

/** Set on the page, for every field under it. */
export const setMentions = (get: () => Mentionable) => setContext(key, get);
export const getMentions = () => getContext<(() => Mentionable) | undefined>(key);

/** Whoever is on a pull request: its author, its reviewers and everyone who commented. */
export function peopleOn(pr: PullRequest): string[] {
	const comments = [...pr.comments, ...pr.threads.flatMap((t) => t.comments)];
	const names = [pr.author, ...pr.reviewers.map((r) => r.name), ...comments.map((c) => c.author)];
	return [...new Set(names.filter(Boolean))];
}

/** The best few for what's typed after `@`: a name starting with it first, then one containing it. */
export function mentionsFor(query: string, { files, people }: Mentionable, limit = 8): Mention[] {
	const q = query.toLowerCase();
	const all: Mention[] = [
		...people.map((login): Mention => ({ kind: 'person', label: login, text: `@${login}` })),
		...files.map((path): Mention => {
			const cut = path.lastIndexOf('/');
			return { kind: 'file', label: path.slice(cut + 1), detail: path.slice(0, cut), text: path };
		})
	];
	const rank = (m: Mention) => {
		const name = m.label.toLowerCase();
		if (name.startsWith(q)) return 0;
		if (name.includes(q)) return 1;
		return m.text.toLowerCase().includes(q) ? 2 : 3;
	};
	return all
		.map((m) => ({ m, r: rank(m) }))
		.filter(({ r }) => r < 3)
		.sort((a, b) => a.r - b.r)
		.slice(0, limit)
		.map(({ m }) => m);
}

/** `@` and what's typed after it, at the cursor, outside code. */
export function mentionAt(state: EditorState): { from: number; query: string } | null {
	const { $from, empty } = state.selection;
	if (!empty || $from.parent.type.spec.code) return null;
	if ($from.marks().some((m) => m.type === schema.marks.code)) return null;
	const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
	const match = /(?:^|\s)@([\w./-]*)$/.exec(before);
	return match ? { from: $from.pos - match[1].length - 1, query: match[1] } : null;
}

/** The `@` and what's typed after it replaced: a file by its path as code, a person by `@login`. */
export function insertMention(state: EditorState, from: number, mention: Mention): Transaction {
	const code = mention.kind === 'file' ? [schema.marks.code.create()] : [];
	const text = [schema.text(mention.text, code), schema.text(' ')];
	return state.tr.replaceWith(from, state.selection.from, text).scrollIntoView();
}
