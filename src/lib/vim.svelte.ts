import { readText, writeText } from './storage';

/** Vim's keys in the text fields, picked in the View menu. Kept in this browser */
export const vimKeys = $state({ on: readText('vim') === 'on' });

export function chooseVim(on: boolean) {
	vimKeys.on = on;
	writeText('vim', on ? 'on' : null);
}
