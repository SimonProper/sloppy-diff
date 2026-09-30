import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { parseDiff } from '$lib/diff/parse';
import type { Guide, GuideDraft } from '$lib/guide/types';

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-guides-')));
vi.mock('$env/dynamic/private', () => ({ env: { ...process.env, GUIDES_DIR: dir } }));

const { deleteGuide, guideEndingAt, listGuides, prepareGuide, reconcile, saveGuide } =
	await import('./guides');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const guide = (repo: string, start: string, stop: string) =>
	({
		repo,
		start,
		stop,
		title: `${start}..${stop}`,
		summary: '',
		createdAt: new Date().toISOString(),
		sections: []
	}) as unknown as Guide;

describe('saved guides', () => {
	test('a deleted guide is gone from the list, the others stay', async () => {
		await saveGuide(guide('/work/one', 'aaaaaaa', 'bbbbbbb'));
		await saveGuide(guide('/work/one', 'ccccccc', 'ddddddd'));
		await deleteGuide('/work/one', 'aaaaaaa', 'bbbbbbb');
		const left = (await listGuides()).filter((g) => g.repo === '/work/one');
		expect(left.map((g) => g.start)).toEqual(['ccccccc']);
	});

	test('only a commit range can name the file to delete', async () => {
		await saveGuide(guide('/work/two', 'eeeeeee', 'fffffff'));
		const before = (await listGuides()).length;
		await expect(deleteGuide('/work/two', '../../etc', 'fffffff')).rejects.toThrow(
			'Invalid commit'
		);
		expect(await listGuides()).toHaveLength(before);
	});

	test('a guide is found by where it ends, the first former tip that has one', async () => {
		await saveGuide(guide('/work/three', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb'));
		await saveGuide(guide('/work/three', 'cccccccccccc', 'dddddddddddd'));
		const tips = ['e'.repeat(40), 'd'.repeat(40), 'b'.repeat(40)];
		expect((await guideEndingAt('/work/three', tips))?.start).toBe('cccccccccccc');
		expect(await guideEndingAt('/work/three', ['e'.repeat(40)])).toBeNull();
	});
});

// three hunks in two files, what a model's draft is checked against
const files = parseDiff(
	[
		'diff --git a/a.ts b/a.ts',
		'--- a/a.ts',
		'+++ b/a.ts',
		'@@ -1 +1 @@',
		'-one',
		'+uno',
		'@@ -10 +10 @@',
		'-two',
		'+dos',
		'diff --git a/b.ts b/b.ts',
		'--- a/b.ts',
		'+++ b/b.ts',
		'@@ -1 +1 @@',
		'-three',
		'+tres',
		''
	].join('\n')
);
const [h1, h2, h3] = files.flatMap((f) => f.hunks.map((h) => h.id));

const draft = (sections: Partial<GuideDraft['sections'][number]>[]): GuideDraft => ({
	title: 't',
	summary: 's',
	sections: sections.map((s, i) => ({
		title: `section ${i + 1}`,
		kind: 'core',
		rationale: 'why',
		commits: [],
		hunks: [],
		notes: [],
		...s
	}))
});

describe('reconcile', () => {
	test('every hunk ends up in exactly one section, whatever the draft says', () => {
		const sections = reconcile(
			draft([
				// h1 twice, an id that doesn't exist, h3 forgotten
				{ hunks: [h1, 'hnope'] },
				{ hunks: [h2, h1] }
			]),
			files
		);
		expect(sections.map((s) => [s.title, s.hunks])).toEqual([
			['section 1', [h1]],
			['section 2', [h2]],
			['Other changes', [h3]]
		]);
	});

	test('a section left without hunks is dropped, notes only stay on their own hunks', () => {
		const sections = reconcile(
			draft([
				{ hunks: ['hnope'] },
				{
					hunks: [h1, h2, h3],
					notes: [
						{ hunk: h2, text: 'mind this' },
						{ hunk: 'hnope', text: 'x' }
					]
				}
			]),
			files
		);
		expect(sections).toHaveLength(1);
		expect(sections[0].notes).toEqual([{ hunk: h2, text: 'mind this' }]);
	});

	test("reconciling a saved guide again doesn't change it", () => {
		const once = reconcile(draft([{ hunks: [h2] }]), files);
		const twice = reconcile({ title: 't', summary: 's', sections: once }, files);
		expect(twice.map((s) => s.hunks)).toEqual(once.map((s) => s.hunks));
	});
});

describe('prepareGuide', () => {
	test('a step that lost hunks, and new ones left over, are marked changed', () => {
		const saved = {
			...guide('/work/r', 'a', 'b'),
			sections: reconcile(draft([{ hunks: [h1] }, { hunks: [h2, h3] }]), files)
		};
		// h2 changed since, a.ts's second hunk is now "-two +deux"
		const now = parseDiff(
			[
				'diff --git a/a.ts b/a.ts',
				'--- a/a.ts',
				'+++ b/a.ts',
				'@@ -1 +1 @@',
				'-one',
				'+uno',
				'@@ -10 +10 @@',
				'-two',
				'+deux',
				'diff --git a/b.ts b/b.ts',
				'--- a/b.ts',
				'+++ b/b.ts',
				'@@ -1 +1 @@',
				'-three',
				'+tres',
				''
			].join('\n')
		);
		const prepared = prepareGuide(saved, now);
		expect(prepared.sections.map((s) => [s.title, s.changed])).toEqual([
			['section 1', false],
			['section 2', true],
			['Other changes', true]
		]);
		expect(prepared.changed).toBe(1);
		expect(prepareGuide(saved, files).changed).toBe(0);
	});
});

describe('rendered markdown', () => {
	const render = (rationale: string) =>
		prepareGuide(
			{
				...guide('/work/r', 'a', 'b'),
				sections: reconcile(draft([{ hunks: [h1, h2, h3], rationale }]), files)
			},
			files
		).sections[0].html;

	test('raw html and images never render, links open in a new tab', () => {
		const html = render(
			'<img src=x onerror=alert(1)> ![p](https://evil.example/?q=1) [docs](https://svelte.dev)'
		);
		expect(html).not.toContain('<img');
		expect(html).toContain('&lt;img');
		expect(html).toContain(
			'<a href="https://svelte.dev" target="_blank" rel="noopener noreferrer">docs</a>'
		);
	});
});
