import type { Thread } from '$lib/ask/types';
import type { DiffFile } from '$lib/diff/types';
import type { PrSummary } from '$lib/pr/types';

/** What the page shows without a diff: before the first one arrives, or when it failed. */
export function noDiff(error: string | null = null) {
	return {
		selection: null,
		lane: null,
		files: [] as DiffFile[],
		changes: null,
		guide: null,
		scope: null,
		threads: [] as Thread[],
		/** the open pull requests, PR mode without one picked. Null without gh or GitHub */
		prs: null as PrSummary[] | null,
		error,
		/** Server-Timing for the steps that came after the header was sent */
		timing: ''
	};
}
