import { invalidateAll } from '$app/navigation';
import { page } from '$app/state';
import { errorText } from '$lib/errors';
import { sameSha } from '$lib/refs';
import { cancelGuide, followGuide, generateGuide } from './guides.remote';
import type { GuideProgress } from './progress';

interface Range {
	repo: string;
	start: string;
	stop: string;
}

/**
 * The guide being written, outside the dialog: closing it or going to another page leaves
 * the progress on screen, on the guide tab it's for and as a spinner on the Guides button.
 */
class GuideJob {
	repo = $state('');
	start = $state('');
	stop = $state('');
	commits = $state(0);
	progress = $state<GuideProgress | null>(null);
	running = $state(false);
	/** written, the page is loading it: its progress stays up until the guide stands in for it */
	done = $state(false);
	failure = $state('');
	#follow = '';

	/** `resolved` is the range as getRange read it, shown while the agent starts */
	async generate(
		request: Range & { pr?: number },
		resolved: { start: string; stop: string; commits: number },
		ondone: (start: string, stop: string) => void
	) {
		this.#follow = '';
		Object.assign(this, { repo: request.repo, ...resolved });
		this.#reset();
		try {
			const started = await generateGuide(request);
			await this.follow({ ...started, repo: request.repo }, resolved.commits, ondone);
		} catch (e) {
			this.failure = errorText(e);
			this.running = false;
		}
	}

	/** Shows a generation already running, started here or by an earlier page load. */
	async follow(range: Range, commits: number, ondone: (start: string, stop: string) => void) {
		const follow = crypto.randomUUID();
		this.#follow = follow;
		Object.assign(this, { ...range, commits });
		this.#reset();
		try {
			for await (const next of followGuide({ ...range, follow })) {
				// a later generation took over
				if (this.#follow !== follow) return;
				this.progress = next;
				if (next.done) {
					this.done = true;
					ondone(next.done.start, next.done.stop);
				}
				if (next.error) this.failure = next.error;
			}
		} catch (e) {
			if (this.#follow === follow) this.failure = errorText(e);
		} finally {
			if (this.#follow === follow) this.running = false;
		}
	}

	cancel() {
		if (this.running) cancelGuide({ repo: this.repo, start: this.start, stop: this.stop });
	}

	/** Whether this is the generation for the range. */
	covers(repo: string, start: string, stop: string) {
		return this.repo === repo && sameSha(this.start, start) && sameSha(this.stop, stop);
	}

	#reset() {
		this.running = true;
		this.done = false;
		this.failure = '';
		this.progress = null;
	}
}

export const guideJob = new GuideJob();

/**
 * What a finished guide does: it opens while the page is still where it was started, elsewhere
 * it only joins the saved ones, going somewhere else while it's written doesn't pull you back.
 */
export function openIfStill(open: (start: string, stop: string) => void) {
	const at = page.url.href;
	return (start: string, stop: string) =>
		page.url.href === at ? open(start, stop) : invalidateAll();
}
