import { isHttpError } from '@sveltejs/kit';
import { tick } from 'svelte';
import { findHunk } from '$lib/diff/hunks';
import type { DiffFile } from '$lib/diff/types';
import { errorText } from '$lib/errors';
import { commentOnReview } from '$lib/pr/pr.remote';
import type { Replying } from '$lib/pr/types';
import { refresh } from '$lib/pr/refresh';
import { readJson, writeJson, writeText } from '$lib/storage';
import { startAnswer, type Answer } from './answer';
import { askClaude, followAnswer, removeThread, stopAnswer } from './ask.remote';
import { spanLabel } from './span';
import {
	linesOf,
	type Anchor,
	type LineSpan,
	type Scope,
	type Side,
	type Suggestion,
	type Thread
} from './types';

/** Just the lines of a span, without what else an anchor carries. */
const spanOf = ({ hunk, start, end, side }: LineSpan): LineSpan => ({
	hunk,
	start,
	end,
	...(side && { side })
});

/** What the server is sent of lines added to a chat. */
const ref = (a: Added) => {
	const lines = linesOf(a);
	return lines ? spanOf(lines) : { path: a.path };
};

/** An answer on its way, as the server last sent it. */
export interface Live extends Answer {
	startedAt: number;
}

/** Lines, or a whole file, added to a chat from the diff, and the guide section they were picked in. */
export type Added = Anchor & { section?: string };

/** A comment on a pull request being written: on lines, or a whole file without them. */
export interface Draft {
	span?: LineSpan;
	path?: string;
	/** without lines, the id of the button the composer floats under */
	at?: string;
	/** the guide section they were picked in */
	section?: string;
	text: string;
}

/** Picking lines from the keyboard: the line it's on, and where the pick started. */
export interface Cursor {
	hunk: string;
	head: number;
	anchor: number;
	side?: Side;
}

/** Whether two comments are about the same lines, or the same whole file. */
const sameAbout = (a: Omit<Draft, 'text'>, b: Omit<Draft, 'text'>) =>
	a.path === b.path &&
	a.span?.hunk === b.span?.hunk &&
	a.span?.start === b.span?.start &&
	a.span?.end === b.span?.end &&
	a.span?.side === b.span?.side;

/** What was typed and not sent yet, kept per diff. */
interface Typed {
	draft?: Draft;
	drafts?: Draft[];
	replies?: Record<string, string>;
	newChat?: string;
	attached?: Record<string, Added[]>;
}

/** How a question reads at a glance, on its marker and in the list. */
export type Status = 'live' | 'error' | 'unread' | 'seen';

interface Config {
	repo: string;
	/** the page's diff: resolved shas for a range, `to` empty for the working tree */
	from: string;
	to: string;
	scope: Scope;
	threads: Thread[];
	/** the diff's files, to label the lines added to a chat */
	files: DiffFile[];
	/** the GitHub pull request the range is, for Claude to know about */
	pr?: number;
	/** the branch the range is the whole of, its threads are saved under its name */
	branch?: string;
	/** its node id, comments go on it */
	prId?: string;
	/** you have a review in progress on it, comments go in there */
	pending?: boolean;
	/** your picture on GitHub, beside what you comment */
	avatar?: string;
}

/**
 * The questions asked about the diff on screen. One per page, shared by the
 * diffs, the composer, the markers and the lens, so a draft or an answer being
 * streamed survives its lines scrolling out of a virtualised diff.
 */
export class Threads {
	#config: () => Config;

	/** the saved threads the page loaded, a new array only once it loads them again */
	#saved = $derived.by(() => this.#config().threads);
	/**
	 * saved threads, from the page load until the page loads them again. Not reset by the
	 * rest of the page's data changing, which would drop a chat started since
	 */
	list = $derived(this.#saved);
	live = $state<Record<string, Live>>({});
	draft = $state<Draft | null>(null);
	/** comments put away unsent, each kept at its own lines until it's opened again */
	drafts = $state<Draft[]>([]);
	/** the composer is open on the draft's lines */
	composing = $state(false);
	cursor = $state<Cursor | null>(null);
	/** follow-ups being typed, by thread */
	replies = $state<Record<string, string>>({});
	/** lines added to a chat from the diff, by thread, sent with its next question. '' the new chat's */
	attached = $state<Record<string, Added[]>>({});
	/** threads whose answer was running when the page loaded, and has gone since */
	lost = $state<Record<string, boolean>>({});

	/** the agent panel is open, on the chat in `open` or else on the list of chats */
	panel = $state(false);
	/** the chat open in the panel or the lens */
	open = $state<string | null>(null);
	/** a new chat about the whole change, being typed under the list */
	newChat = $state('');
	/** the lens over the whole page, instead of docked beside the diff */
	expanded = $state(false);
	/** a chat asked about another diff, to open once the page has loaded that diff */
	opening = $state<string | null>(null);
	/** a marker being hovered, and where to show its peek */
	peek = $state<{ id: string; x: number; y: number } | null>(null);

	// what has been read is a per-browser convenience, like reviewed guide sections
	#seenKey = $derived.by(() => {
		const { repo, scope } = this.#config();
		return `sloppy-diff:ask-seen:${repo}:${scope}`;
	});
	/** answers read so far, by thread */
	seen = $derived.by(() => readJson<Record<string, number>>(this.#seenKey, {}));
	/** answered trails start open, remembered per browser */
	trailOpen = $state(readJson<boolean>('sloppy-diff:ask-trail', false));
	/** on a pull request, what the composer sends: a question to Claude or your comment */
	intent = $state<'ask' | 'comment'>(readJson('sloppy-diff:compose-intent', 'ask'));

	running = $derived(Object.keys(this.live).length);

	// what's typed and not sent yet outlives a failed send, a crash or a reload, per diff
	#typedKey = $derived.by(() => {
		const { repo, scope } = this.#config();
		return `sloppy-diff:ask-typed:${repo}:${scope}`;
	});

	constructor(config: () => Config) {
		this.#config = config;
		let restored = '';
		$effect(() => {
			const key = this.#typedKey;
			if (key !== restored) {
				// another diff, or the page loaded: what was being typed on it comes back, open
				restored = key;
				const typed = readJson<Typed>(key, {});
				this.draft = typed.draft ?? null;
				this.drafts = typed.drafts ?? [];
				this.composing = !!typed.draft;
				this.replies = typed.replies ?? {};
				this.newChat = typed.newChat ?? '';
				this.attached = typed.attached ?? {};
			}
			const replies = Object.entries(this.replies).filter(([, text]) => text.trim());
			const attached = Object.entries(this.attached).filter(([, added]) => added.length);
			const typed: Typed = {
				draft: this.draft?.text.trim() ? this.draft : undefined,
				drafts: this.drafts.length ? this.drafts : undefined,
				replies: replies.length ? Object.fromEntries(replies) : undefined,
				newChat: this.newChat.trim() || undefined,
				attached: attached.length ? Object.fromEntries(attached) : undefined
			};
			if (typed.draft || typed.drafts || typed.replies || typed.newChat || typed.attached)
				writeJson(key, typed);
			else writeText(key, null);
		});
		$effect(() => {
			if (this.opening && this.get(this.opening)) {
				this.openLens(this.opening);
				this.opening = null;
			}
		});
	}

	/** Threads anchored to lines in any of these hunks. */
	in(hunks: string[]): Thread[] {
		const ids = new Set(hunks);
		return this.list.filter((t) => !t.outdated && ids.has(t.anchor.hunk ?? ''));
	}

	/** the repo and the diff the threads are saved under */
	get where(): { repo: string; scope: Scope } {
		const { repo, scope } = this.#config();
		return { repo, scope };
	}

	/** where a comment goes, null outside a pull request */
	get review(): {
		repo: string;
		number: number;
		pr: string;
		commit: string;
		pending: boolean;
		avatar: string;
	} | null {
		const { repo, pr, prId, to, pending = false, avatar = '' } = this.#config();
		return pr && prId ? { repo, number: pr, pr: prId, commit: to, pending, avatar } : null;
	}

	/**
	 * Comments on the pull request, with `post` at once, otherwise in your pending review,
	 * then loads the page again so it shows on its lines. Says whether it was added or was
	 * in the review already.
	 */
	async comment(suggestion: Suggestion, post = false) {
		const review = this.review;
		if (!review) throw new Error('Comments go on a pull request');
		const { pending: _, ...at } = review;
		const result = await commentOnReview({ ...at, suggestion, post });
		await refresh();
		return result;
	}

	/** replying to review threads, undefined outside a pull request */
	get replying(): Replying | undefined {
		const review = this.review;
		return review
			? {
					pending: review.pending,
					send: (thread, body, post) => this.comment({ kind: 'reply', thread, body }, post)
				}
			: undefined;
	}

	get(id: string | null): Thread | undefined {
		return id ? this.list.find((t) => t.id === id) : undefined;
	}

	status(thread: Thread): Status {
		if (this.live[thread.id]) return 'live';
		const last = thread.messages.at(-1);
		if (this.lost[thread.id] || (last?.error && last.error !== 'Cancelled')) return 'error';
		return answers(thread) > (this.seen[thread.id] ?? 0) ? 'unread' : 'seen';
	}

	markSeen(thread: Thread) {
		const count = answers(thread);
		if ((this.seen[thread.id] ?? 0) >= count) return;
		this.seen = { ...this.seen, [thread.id]: count };
		writeJson(this.#seenKey, this.seen);
	}

	setIntent(intent: 'ask' | 'comment') {
		this.intent = intent;
		writeJson('sloppy-diff:compose-intent', intent);
	}

	toggleTrail() {
		this.trailOpen = !this.trailOpen;
		writeJson('sloppy-diff:ask-trail', this.trailOpen);
	}

	/**
	 * Lines picked in the diff: to the agent panel, or on a pull request to comment on, as picked.
	 * `fresh`: to a new chat, not the one open in the panel.
	 */
	select(span: LineSpan, section?: string, fresh = false) {
		if (this.review && this.intent === 'comment') this.#compose({ span, section });
		else this.add({ span, section, fresh });
	}

	/** what the panel's chat, or the new one under its list, will be sent with its next question */
	get adding(): Added[] {
		return this.attached[this.get(this.open) ? this.open! : ''] ?? [];
	}

	/** A whole file, to the agent panel or to comment on, its comment under the button `at`. */
	selectWhole(path: string, section: string | undefined, at: string) {
		if (this.review && this.intent === 'comment') this.#compose({ path, section, at });
		else this.add({ path, section });
	}

	/**
	 * Adds lines, or a whole file, to the chat open in the panel for its next follow-up, or with
	 * the list open or `fresh` to the new chat under it, and opens the panel on its field.
	 * `text`: what was typed about them already, added to the field.
	 */
	add({
		span,
		path,
		section,
		text = '',
		fresh = false
	}: Omit<Draft, 'at' | 'text'> & { text?: string; fresh?: boolean }) {
		let added: Added;
		if (span) {
			const found = findHunk(this.#config().files, span.hunk);
			if (!found) return;
			const label = spanLabel(found.hunk, span);
			added = { ...span, path: found.file.newPath, label, code: '', section };
		} else if (path) added = { path, label: 'whole file', code: '', section };
		else return;

		if (fresh || !this.get(this.open)) this.back();
		const id = this.open ?? '';
		const before = this.attached[id] ?? [];
		const same = (a: Added) =>
			a.path === added.path &&
			a.hunk === added.hunk &&
			a.start === added.start &&
			a.end === added.end &&
			a.side === added.side;
		if (!before.some(same)) this.attached[id] = [...before, added];
		const typed = text.trim();
		if (typed) {
			const field = id ? (this.replies[id] ?? '') : this.newChat;
			const value = [field.trim(), typed].filter(Boolean).join('\n');
			if (id) this.replies[id] = value;
			else this.newChat = value;
		}

		this.putAway();
		this.cursor = null;
		this.peek = null;
		this.panel = true;
		// straight to asking about them, in whichever field the panel shows
		// a frame on, after a field that has just opened has taken the focus itself
		tick().then(() =>
			requestAnimationFrame(() =>
				document
					.querySelector<HTMLElement>('[data-ask-field] [contenteditable]')
					?.focus({ preventScroll: true })
			)
		);
	}

	/**
	 * The comment open on lines, or a whole file: the one put away there before, or a new
	 * one. Another one open elsewhere is put away at its own lines.
	 */
	#compose(about: Omit<Draft, 'text'>) {
		const before = this.draft;
		if (before && sameAbout(before, about)) {
			this.draft = { ...about, text: before.text };
		} else {
			this.putAway();
			const kept = this.drafts.find((d) => sameAbout(d, about));
			this.drafts = this.drafts.filter((d) => d !== kept);
			this.draft = { ...about, text: kept?.text ?? '' };
		}
		this.composing = true;
		this.cursor = null;
	}

	/** Opens a comment put away unsent, from its mark in the diff. */
	reopen(draft: Draft) {
		const { text: _, ...about } = draft;
		this.#compose(about);
	}

	/** Closes the comment open on lines, keeping it at them if anything's typed. */
	putAway() {
		const draft = this.draft;
		if (draft?.text.trim())
			this.drafts = [...this.drafts.filter((d) => !sameAbout(d, draft)), draft];
		this.draft = null;
		this.composing = false;
	}

	/** Opens the panel on a chat. */
	openLens(id: string) {
		if (!this.get(id)) return;
		this.open = id;
		this.panel = true;
		this.peek = null;
	}

	/** Opens the panel on what it showed last, a chat or the list. */
	show() {
		if (!this.get(this.open)) this.open = null;
		this.panel = true;
	}

	/** From a chat back to the list. */
	back() {
		this.open = null;
		this.expanded = false;
	}

	close() {
		this.panel = false;
		this.expanded = false;
	}

	/**
	 * Asks as a follow-up in `thread`, or in a new chat about the lines added to it, the first
	 * of them where it sits in the diff, or about the whole change without any. With `blast`,
	 * the new chat asks for the blast radius of its lines instead of `text`. Returns its id.
	 */
	async ask(
		text: string,
		thread?: string,
		options: { retry?: boolean; blast?: boolean } = {}
	): Promise<string> {
		const { repo, from, to, pr, branch } = this.#config();
		const added = this.attached[thread ?? ''] ?? [];
		const [first, ...rest] = added;
		const lines = first && linesOf(first);
		const { scope, thread: saved } = await askClaude({
			repo,
			from,
			to,
			pr,
			branch,
			text,
			...(thread
				? {
						thread,
						retry: options.retry === true,
						context: options.retry ? undefined : added.map(ref)
					}
				: first
					? {
							...(lines ? { span: spanOf(lines) } : { path: first.path }),
							section: first.section,
							blast: options.blast === true,
							context: rest.map(ref)
						}
					: {})
		});

		this.#upsert(saved);
		delete this.lost[saved.id];
		if (thread) {
			delete this.replies[thread];
			// a retry asks the last question again, the lines added since wait for the next one
			if (!options.retry) delete this.attached[thread];
		} else {
			this.newChat = '';
			delete this.attached[''];
		}
		this.follow(saved.id, scope);
		return saved.id;
	}

	/** Asks a thread's last question again, after it failed, stopped or got lost. */
	retry(id: string) {
		return this.ask('', id, { retry: true });
	}

	/** Streams the answer being written in a thread, from the start. */
	async follow(id: string, scope = this.#config().scope) {
		const { repo } = this.#config();
		const startedAt = Date.now();
		this.live[id] = { ...startAnswer(), startedAt };
		delete this.lost[id];
		try {
			const follow = crypto.randomUUID();
			for await (const answer of followAnswer({ repo, scope, thread: id, follow })) {
				this.live[id] = { ...answer, startedAt };
				if (answer.thread) this.#upsert(answer.thread);
				if (answer.error) this.#fail(id, answer.error);
			}
		} catch (e) {
			if (isHttpError(e, 404)) this.lost[id] = true;
			else this.#fail(id, errorText(e));
		} finally {
			delete this.live[id];
		}
	}

	/** Picks up answers that were still being written when the page loaded. */
	resume() {
		for (const thread of this.list) {
			const last = thread.messages.at(-1);
			if (last?.role === 'user' && !this.live[thread.id] && !this.lost[thread.id]) {
				this.follow(thread.id);
			}
		}
	}

	cancel(id: string) {
		const { repo, scope } = this.#config();
		stopAnswer({ repo, scope, thread: id });
	}

	async remove(id: string) {
		const { repo, scope } = this.#config();
		await removeThread({ repo, scope, thread: id });
		this.list = this.list.filter((t) => t.id !== id);
		delete this.replies[id];
		delete this.attached[id];
		if (this.open === id) this.back();
	}

	/** Shows an answer that failed the way the server saved it. */
	#fail(id: string, error: string) {
		const thread = this.list.find((t) => t.id === id);
		if (!thread || thread.messages.at(-1)?.role !== 'user') return;
		this.#upsert({
			...thread,
			messages: [
				...thread.messages,
				{ role: 'assistant', text: '', error, createdAt: new Date().toISOString() }
			]
		});
	}

	#upsert(thread: Thread) {
		this.list = this.list.some((t) => t.id === thread.id)
			? this.list.map((t) => (t.id === thread.id ? thread : t))
			: [...this.list, thread];
	}
}

/** Answers that came back, failed ones not counted. */
function answers(thread: Thread): number {
	return thread.messages.filter((m) => m.role === 'assistant' && !m.error).length;
}
