import { query } from '$app/server';
import { error } from '@sveltejs/kit';
import { readFileAt, repoRoot } from '$lib/server/git';
import { highlightText } from '$lib/server/highlight';
import { badRequestOnError } from '$lib/server/requests';

/**
 * A file's every line at `rev`, or in the working tree when `rev` is empty: the
 * text, to check it's still the file the diff was read from, and its markup.
 */
export const getWholeFile = query(
	'unchecked',
	({ repo, rev, path }: { repo: string; rev: string; path: string }) =>
		badRequestOnError(async () => {
			const text = await readFileAt(await repoRoot(repo), rev, path);
			if (text === null) error(404, `${path} isn't there anymore`);
			const lines = text.split('\n');
			if (text.endsWith('\n')) lines.pop();
			return { text: lines, html: highlightText(path, lines) };
		})
);
