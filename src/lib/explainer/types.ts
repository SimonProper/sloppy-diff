import type { AgentProvider } from '$lib/agent';

export interface ExplainerRange {
	repo: string;
	start: string;
	stop: string;
}

/** The complete document Claude returns, rendered in an isolated frame. */
export interface ExplainerDraft {
	title: string;
	summary: string;
	html: string;
}

export interface VisualExplainer extends ExplainerDraft, ExplainerRange {
	version: 1;
	createdAt: string;
	model: string;
	provider?: AgentProvider;
}

export type ExplainerEvent =
	| { type: 'status'; text: string }
	| { type: 'tool'; text: string }
	| { type: 'done'; start: string; stop: string }
	| { type: 'error'; message: string };

export interface ExplainerProgress {
	status: string | null;
	tools: string[];
	done?: { start: string; stop: string };
	error?: string;
}

export const startExplainerProgress = (): ExplainerProgress => ({ status: null, tools: [] });

/** Folds one background event into the progress sent to the page. */
export function applyExplainerEvent(
	progress: ExplainerProgress,
	event: ExplainerEvent
): ExplainerProgress {
	if (event.type === 'status') progress.status = event.text;
	else if (event.type === 'tool') progress.tools.push(event.text);
	else if (event.type === 'done') progress.done = { start: event.start, stop: event.stop };
	else progress.error = event.message;
	return progress;
}
