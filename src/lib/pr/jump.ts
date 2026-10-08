import { reveal } from '$lib/ask/rows';
import { spanAt } from '$lib/diff/hunks';
import type { DiffFile } from '$lib/diff/types';
import type { ReviewThread } from './types';

/** Where a thread is, short: its file's name and last line. */
export const where = (t: ReviewThread) =>
	`${t.path.split('/').pop()}${t.file || t.line === null ? '' : `:${t.line}`}`;

/** Scrolls to the thread's lines and opens its card, or to its file when it has no lines here. */
export async function jumpToThread(thread: ReviewThread, files: DiffFile[]) {
	const span =
		thread.isOutdated || thread.line === null
			? null
			: spanAt(files, thread.path, thread.side, thread.line, thread.startLine ?? thread.line);
	if (span) await reveal(span);
	const marker = document.querySelector<HTMLElement>(`[data-review~="${CSS.escape(thread.id)}"]`);
	if (marker) marker.click();
	else
		document
			.querySelector(`[data-path="${CSS.escape(thread.path)}"]`)
			?.scrollIntoView({ block: 'start' });
}
