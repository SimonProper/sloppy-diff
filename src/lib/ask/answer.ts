import type { AskEvent, Step, Thread } from './types';

/** An answer on its way: what Claude has said so far, folded from its events. */
export interface Answer {
	status: string;
	steps: Step[];
	/** the answer so far */
	text: string;
	thinkingTokens: number;
	/** the saved thread, once the answer is in */
	thread?: Thread;
	error?: string;
}

export const startAnswer = (): Answer => ({
	status: 'Starting Claude',
	steps: [],
	text: '',
	thinkingTokens: 0
});

/** Folds one event into the answer, in place. */
export function applyAskEvent(answer: Answer, event: AskEvent): Answer {
	// text before a thought or a tool call was said on the way, not the answer
	const aside = () => {
		if (answer.text.trim()) answer.steps.push({ type: 'text', text: answer.text.trim() });
		answer.text = '';
	};
	switch (event.type) {
		case 'status':
			answer.status = event.text;
			break;
		case 'thinking': {
			aside();
			const last = answer.steps.at(-1);
			if (last?.type === 'thinking') last.text += event.text;
			else answer.steps.push({ type: 'thinking', text: event.text });
			answer.status = 'Thinking';
			break;
		}
		case 'thinking_tokens':
			answer.thinkingTokens = event.tokens;
			break;
		case 'tool':
			aside();
			answer.steps.push({ type: 'tool', text: event.text });
			answer.status = event.text;
			break;
		case 'text':
			answer.text += event.text;
			answer.status = 'Answering';
			break;
		case 'done':
			answer.thread = event.thread;
			break;
		case 'error':
			answer.error = event.message;
			break;
	}
	return answer;
}
