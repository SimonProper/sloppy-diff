import { askClaude, removeThread, stopAnswer } from './ask.remote';
import type { AskEvent, LineSpan, Scope, Side, Step, Thread } from './types';

/** An answer on its way, built up from the streamed events. */
export interface Live {
	status: string;
	steps: Step[];
	/** the answer so far */
	text: string;
	thinkingTokens: number;
	startedAt: number;
}

/** Lines picked for a new question, and what's been typed about them. */
export interface Draft {
	span: LineSpan;
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

	/** threads still anchored in the diff, by hunk and their first line */
	placed = $derived.by(() => {
		const map = new Map<string, Thread[]>();
		for (const thread of this.list) {
			if (thread.outdated) continue;
			const key = `${thread.anchor.hunk}:${thread.anchor.start}`;
			map.set(key, [...(map.get(key) ?? []), thread]);
		}
		return map;
	});
	outdated = $derived(this.list.filter((t) => t.outdated));
	running = $derived(Object.keys(this.live).length);

	constructor(config: () => Config) {
		this.#config = config;
	}

	/** Threads whose lines start at line `index` of a hunk. */
	at(hunk: string, index: number): Thread[] {
		return this.placed.get(`${hunk}:${index}`) ?? [];
	}

	/** Threads anchored to lines in any of these hunks. */
	in(hunks: string[]): Thread[] {
		const ids = new Set(hunks);
		return this.list.filter((t) => !t.outdated && ids.has(t.anchor.hunk));
	}

	count(hunks: string[]): number {
		return this.in(hunks).length;
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
		const keep = this.draft?.text ?? '';
		this.draft = { span, section, text: keep };
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
	}

	/**
	 * Asks in a new thread about the draft's lines, or as a follow-up in
	 * `thread`. Returns the thread's id.
	 */
	async ask(text: string, thread?: string, options: { retry?: boolean } = {}): Promise<string> {
		const { repo, from, to } = this.#config();
		const draft = this.draft;
		const { scope, thread: saved } = await askClaude({
			repo,
			from,
			to,
			text,
			...(thread
				? { thread, retry: options.retry === true }
				: { span: draft?.span, section: draft?.section })
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
		this.live[id] = {
			status: 'Starting Claude',
			steps: [],
			text: '',
			thinkingTokens: 0,
			startedAt: Date.now()
		};
		delete this.lost[id];
		try {
			const res = await fetch(
				`/api/ask/events?${new URLSearchParams({ repo, scope, thread: id })}`
			);
			if (res.status === 404) {
				this.lost[id] = true;
				return;
			}
			if (!res.ok || !res.body) throw new Error('Lost track of the answer');
			await readLines(res.body, (event: AskEvent) => this.#apply(id, event));
		} catch (e) {
			this.#fail(id, e instanceof Error ? e.message : String(e));
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

	#apply(id: string, event: AskEvent) {
		const live = this.live[id];
		if (!live) return;
		// text before a thought or a tool call was said on the way, not the answer
		const aside = () => {
			if (live.text.trim()) live.steps.push({ type: 'text', text: live.text.trim() });
			live.text = '';
		};
		switch (event.type) {
			case 'status':
				live.status = event.text;
				break;
			case 'thinking': {
				aside();
				const last = live.steps.at(-1);
				if (last?.type === 'thinking') last.text += event.text;
				else live.steps.push({ type: 'thinking', text: event.text });
				live.status = 'Thinking';
				break;
			}
			case 'thinking_tokens':
				live.thinkingTokens = event.tokens;
				break;
			case 'tool':
				aside();
				live.steps.push({ type: 'tool', text: event.text });
				live.status = event.text;
				break;
			case 'text':
				live.text += event.text;
				live.status = 'Answering';
				break;
			case 'done':
				this.#upsert(event.thread);
				break;
			case 'error':
				this.#fail(id, event.message);
				break;
		}
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

function readJson<T>(key: string, fallback: T): T {
	try {
		const value = localStorage.getItem(key);
		return value === null ? fallback : JSON.parse(value);
	} catch {
		return fallback;
	}
}

function writeJson(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// private windows can refuse storage, it still works for this visit
	}
}

/** Calls `onEvent` for every line of an NDJSON stream. */
async function readLines<T>(body: NonNullable<Response['body']>, onEvent: (event: T) => void) {
	const reader = body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines.filter(Boolean)) onEvent(JSON.parse(line));
	}
}
