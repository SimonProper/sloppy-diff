import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import type { DiffFile } from '$lib/diff/types';
import type { Guide, GuideDraft, GuideListing, GuideSection } from '$lib/guide/types';
import { markdown } from './markdown';

function guidesDir(): string {
	return resolve(env.GUIDES_DIR || join(process.cwd(), '.guides'));
}

/**
 * Guides live outside the reviewed repo, one folder per repo named after its
 * path the way Claude Code names its project folders.
 */
export function repoDir(root: string): string {
	return join(guidesDir(), root.replace(/[^a-zA-Z0-9]/g, '-'));
}

function guidePath(root: string, start: string, stop: string): string {
	return join(repoDir(root), `${start}..${stop}.json`);
}

export async function loadGuide(root: string, start: string, stop: string): Promise<Guide | null> {
	try {
		return JSON.parse(await readFile(guidePath(root, start, stop), 'utf8'));
	} catch {
		return null;
	}
}

export async function saveGuide(guide: Guide): Promise<void> {
	await mkdir(repoDir(guide.repo), { recursive: true });
	await writeFile(
		guidePath(guide.repo, guide.start, guide.stop),
		JSON.stringify(guide, null, '\t')
	);
}

/** Removes a saved guide, the range is checked so it can only name a guide file. */
export async function deleteGuide(root: string, start: string, stop: string): Promise<void> {
	for (const sha of [start, stop]) {
		if (!/^[0-9a-f]{4,64}$/.test(sha)) throw new Error(`Invalid commit: ${sha}`);
	}
	await rm(guidePath(root, start, stop), { force: true });
}

/** Saved guides for every repo, newest first. */
export async function listGuides(): Promise<GuideListing[]> {
	const root = guidesDir();
	const repos = await readdir(root).catch(() => [] as string[]);
	const files = await Promise.all(
		repos.map(async (repo) => {
			const names = await readdir(join(root, repo)).catch(() => [] as string[]);
			return names.filter((n) => n.endsWith('.json')).map((n) => join(root, repo, n));
		})
	);
	const guides = await Promise.all(
		files.flat().map(async (path) => {
			try {
				const g: Guide = JSON.parse(await readFile(path, 'utf8'));
				return {
					repo: g.repo,
					title: g.title,
					start: g.start,
					stop: g.stop,
					createdAt: g.createdAt,
					sections: g.sections.length
				};
			} catch {
				return null;
			}
		})
	);
	return guides
		.filter((g): g is GuideListing => g !== null)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Turns Claude's draft into a guide that covers the diff exactly once: unknown
 * hunk ids are dropped, a hunk claimed twice stays with its first section, and
 * every hunk nobody claimed lands in a trailing "Other changes" section, so a
 * guide can never hide code.
 */
export function reconcile(draft: GuideDraft, files: DiffFile[]): GuideSection[] {
	const known = new Set(files.flatMap((f) => f.hunks.map((h) => h.id)));
	const claimed = new Set<string>();

	const sections: GuideSection[] = draft.sections
		.map((s, i) => {
			const hunks = s.hunks.filter((id) => known.has(id) && !claimed.has(id));
			hunks.forEach((id) => claimed.add(id));
			return {
				...s,
				id: `s${i + 1}`,
				hunks,
				notes: (s.notes ?? []).filter((n) => hunks.includes(n.hunk)),
				commits: s.commits ?? []
			};
		})
		.filter((s) => s.hunks.length > 0);

	const rest = files.flatMap((f) => f.hunks.map((h) => h.id)).filter((id) => !claimed.has(id));
	if (rest.length > 0) {
		sections.push({
			id: 'other',
			title: 'Other changes',
			kind: 'chore',
			rationale: 'Changes the guide did not place in a section.',
			commits: [],
			hunks: rest,
			notes: []
		});
	}
	return sections;
}

/** Re-checks a stored guide against the current diff and renders its markdown. */
export function prepareGuide(guide: Guide, files: DiffFile[]): Guide {
	const sections = reconcile(guide, files).map((s) => ({
		...s,
		html: markdown.render(s.rationale)
	}));
	return { ...guide, sections, summaryHtml: markdown.render(guide.summary) };
}
