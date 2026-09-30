/** A key pressed in a field, a dialog or the question panel, which page shortcuts leave alone. */
export const typing = (event: KeyboardEvent) =>
	!!(event.target as HTMLElement).closest(
		'input, textarea, [contenteditable], dialog, [data-ask-dock]'
	);
