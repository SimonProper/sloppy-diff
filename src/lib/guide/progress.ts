import type { GuideEvent } from './types';

/** How a generation is going, folded from its events. */
export interface GuideProgress {
	status: string | null;
	/** what Claude looked at, in order */
	tools: string[];
	/** the range of the saved guide, once it's written */
	done?: { start: string; stop: string };
	error?: string;
}

export const startProgress = (): GuideProgress => ({ status: null, tools: [] });

/** Folds one event into the progress, in place. */
export function applyGuideEvent(progress: GuideProgress, event: GuideEvent): GuideProgress {
	if (event.type === 'status') progress.status = event.text;
	else if (event.type === 'tool') progress.tools.push(event.text);
	else if (event.type === 'done') progress.done = { start: event.start, stop: event.stop };
	else progress.error = event.message;
	return progress;
}
