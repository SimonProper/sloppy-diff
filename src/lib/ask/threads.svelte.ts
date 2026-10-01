import { isHttpError } from '@sveltejs/kit';
import { invalidateAll } from '$app/navigation';
import { errorText } from '$lib/errors';
import { addDraft } from '$lib/pr/pr.remote';
import { readJson, writeJson } from '$lib/storage';
import { startAnswer, type Answer } from './answer';
import { askClaude, followAnswer, removeThread, stopAnswer } from './ask.remote';
import type { LineSpan, Scope, Side, Suggestion, Thread } from './types';

/** An answer on its way, as the server last sent it. */
export interface Live extends Answer {
	startedAt: number;
}

/**
 * What a new question is about, and what's been typed: lines, a whole file without them,
 * or the whole change without a path either.
 */
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

/** How a question reads at a glance, on its marker and in the list. */
export type Status = 'live' | 'error' | 'unread' | 'seen';

interface Config {
	repo: string;
	/** the page's diff: resolved shas for a range, `to` empty for the working tree */
	from: string;
	to: string;
	scope: Scope;
	threads: Thread[];
	/** the GitHub pull request the range is, for Claude to know about */
	pr?: number;
	/** its node id, suggested comments are added to your pending review on it */
	prId?: string;
}

/**
 * The questions asked about the diff on screen. One per page, shared by the
 * diffs, the composer, the markers and the lens, so a draft or an answer being
 * streamed survives its lines scrolling out of a virtualised diff.
 */
export class Threads {
	#config: () => Config;

	/** saved threads, from the page load until the page loads another diff */
	list = $derived.by(() => this.#config().threads);
	live = $state<Record<string, Live>>({});
	draft = $state<Draft | null>(null);
	/** the composer is open on the draft's lines */
	composing = $state(false);
	cursor = $state<Cursor | null>(null);
	/** follow-ups being typed, by thread */
	replies = $state<Record<string, string>>({});
	/** threads whose answer was running when the page loaded, and has gone since */
	lost = $state<Record<string, boolean>>({});

	/** the question open in the lens */
	open = $state<string | null>(null);
	/** the lens over the whole page, instead of docked beside the diff */
	expanded = $state(false);
	#lastOpen: string | null = null;
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

	running = $derived(Object.keys(this.live).length);

	constructor(config: () => Config) {
		this.#config = config;
	}

	/** Threads anchored to lines in any of these hunks. */
	in(hunks: string[]): Thread[] {
		const ids = new Set(hunks);
		return this.list.filter((t) => !t.outdated && ids.has(t.anchor.hunk ?? ''));
	}

	/** where Add to draft puts a suggested comment, null outside a pull request */
	get review(): { repo: string; pr: string; commit: string } | null {
		const { repo, prId, to } = this.#config();
		return prId ? { repo, pr: prId, commit: to } : null;
	}

	/**
	 * Adds a comment to your pending review on the pull request, then loads the page again
	 * so it shows on its lines.
	 */
	async addToReview(suggestion: Suggestion) {
		const review = this.review;
		if (!review) throw new Error('Comments go on a pull request');
		await addDraft({ ...review, suggestion });
		await invalidateAll();
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

	toggleTrail() {
		this.trailOpen = !this.trailOpen;
		writeJson('sloppy-diff:ask-trail', this.trailOpen);
	}

	select(span: LineSpan, section?: string) {
		this.#compose({ span, section });
	}

	/**
	 * A new question about a whole file, or without `path` about the whole change, its
	 * composer under the button `at`.
	 */
	selectWhole(path: string | undefined, section: string | undefined, at: string) {
		this.#compose({ path, section, at });
	}

	#compose(about: Omit<Draft, 'text'>) {
		const keep = this.draft?.text ?? '';
		this.draft = { ...about, text: keep };
		this.composing = true;
		this.cursor = null;
	}

	/** Opens the lens on a question, else the last one open, else the newest. */
	openLens(id?: string) {
		const target = this.get(id ?? null) ?? this.get(this.#lastOpen) ?? this.list.at(-1);
		if (!target) return;
		this.open = target.id;
		this.#lastOpen = target.id;
		this.peek = null;
	}

	close() {
		this.open = null;
		this.expanded = false;
	}

	/**
	 * Asks in a new thread about the draft's lines, or as a follow-up in
	 * `thread`. Returns the thread's id.
	 */
	async ask(text: string, thread?: string, options: { retry?: boolean } = {}): Promise<string> {
		const { repo, from, to, pr } = this.#config();
		const draft = this.draft;
		const { scope, thread: saved } = await askClaude({
			repo,
			from,
			to,
			pr,
			text,
			...(thread
				? { thread, retry: options.retry === true }
				: { span: draft?.span, path: draft?.path, section: draft?.section })
		});

		this.#upsert(saved);
		delete this.lost[saved.id];
		if (thread) delete this.replies[thread];
		else {
			this.draft = null;
			this.composing = false;
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
		if (this.open === id) this.open = null;
		if (this.#lastOpen === id) this.#lastOpen = null;
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
