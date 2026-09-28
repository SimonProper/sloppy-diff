import { getContext, setContext } from 'svelte';

/**
 * Shared between a Popover and its trigger and content. `open` reads and
 * writes through to the Popover's bindable prop, so parents stay in charge.
 */
export class PopoverState {
	trigger = $state<HTMLElement>();

	constructor(
		readonly id: string,
		private readonly read: () => boolean,
		private readonly write: (open: boolean) => void
	) {}

	get open() {
		return this.read();
	}

	set open(value: boolean) {
		this.write(value);
	}

	get triggerId() {
		return `${this.id}-trigger`;
	}

	get contentId() {
		return `${this.id}-content`;
	}

	/** CSS anchor name tying the content's position to the trigger */
	get anchor() {
		return `--${this.id}`;
	}
}

const KEY = Symbol('popover');

export function setPopover(state: PopoverState) {
	setContext(KEY, state);
}

export function usePopover(): PopoverState {
	const state = getContext<PopoverState | undefined>(KEY);
	if (!state) throw new Error('PopoverTrigger and PopoverContent must be used inside a Popover');
	return state;
}
