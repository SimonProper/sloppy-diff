/** A key pressed in a field or a dialog, which page shortcuts leave alone. */
export const typing = (event: KeyboardEvent) =>
	!!(event.target as HTMLElement).closest('input, textarea, [contenteditable], dialog');
