let shown = 0;

/**
 * Shows a dialog as modal for as long as it's on the page, an attachment, the page behind it
 * kept from scrolling. A class on <html> rather than html:has(dialog:modal), which had the
 * browser check and restyle <html> for every node put on the page.
 */
export function modal(dialog: HTMLDialogElement) {
	dialog.showModal();
	if (shown++ === 0) document.documentElement.classList.add('modal-open');
	return () => {
		dialog.close();
		if (--shown === 0) document.documentElement.classList.remove('modal-open');
	};
}
