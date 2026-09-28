import type { ChangeMode } from '$lib/diff/types';
import { novel, type Result } from './fixture';

/**
 * What each change mode must produce on the fixture repo. `pnpm test` and the
 * /smoke page both run this list, so they can't disagree. A check returns
 * true or a description of what it got instead.
 */
export interface Check {
	mode: ChangeMode;
	file: string;
	label: string;
	run: (result: Result) => true | string;
}

function same(actual: unknown, expected: unknown): true | string {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	return a === e ? true : `expected ${e}, got ${a}`;
}

function all(...results: (true | string)[]): true | string {
	return results.find((r) => r !== true) ?? true;
}

function changed(r: Result, file: string) {
	return r
		.file(file)
		.hunks.flatMap((h) => h.lines)
		.filter((l) => l.kind !== 'ctx');
}

const FILES = [
	'src/cart.ts',
	'src/format.ts',
	'src/label.ts',
	'NOTES.txt',
	'src/util.ts',
	'src/helpers.ts',
	'src/math.ts'
];

export const CHECKS: Check[] = [
	// lines
	...FILES.map((file): Check => ({
		mode: 'lines',
		file,
		label: 'whole lines only, nothing highlighted inside them',
		run: (r) => {
			const f = r.file(file);
			if (f.changes) return 'ran the change engine';
			const lines = f.hunks.flatMap((h) => h.lines);
			if (lines.some((l) => l.spans)) return 'a line has highlighted pieces';
			if (lines.some((l) => l.moved)) return 'a line is marked as moved';
			if (lines.some((l) => l.moveLabel)) return 'a line has a move label';
			if (lines.some((l) => l.html?.includes('novel'))) return 'markup contains novel';
			return true;
		}
	})),

	// tokens
	{
		mode: 'tokens',
		file: 'src/cart.ts',
		label: 'the rename highlights only qty and quantity',
		run: (r) =>
			all(
				same(novel(r.line('src/cart.ts', 'del', 'qty: number')), ['qty']),
				same(novel(r.line('src/cart.ts', 'add', 'quantity: number')), ['quantity']),
				same(novel(r.line('src/cart.ts', 'del', 'item.qty, 0')), ['qty']),
				same(novel(r.line('src/cart.ts', 'add', 'item.quantity, 0')), ['quantity'])
			)
	},
	{
		mode: 'tokens',
		file: 'src/cart.ts',
		label: 'the highlight is an overlay that keeps syntax colours',
		run: (r) => {
			const html = r.line('src/cart.ts', 'add', 'quantity: number').html ?? '';
			if (!html.includes('<span class="tok novel">')) return 'no novel overlay in the markup';
			if (!/class="tok [a-z_]+">quantity</.test(html)) return 'quantity lost its token class';
			return true;
		}
	},
	{
		mode: 'tokens',
		file: 'src/cart.ts',
		label: 'describe() moving to the top is recognised on both sides',
		run: (r) => {
			const added = r.line('src/cart.ts', 'add', 'export function describe');
			const removed = r.line('src/cart.ts', 'del', 'export function describe');
			return all(
				same(added.moved, true),
				same(removed.moved, true),
				/^moved from line \d+$/.test(added.moveLabel ?? '') ? true : `label: ${added.moveLabel}`,
				/^moved to line \d+$/.test(removed.moveLabel ?? '') ? true : `label: ${removed.moveLabel}`
			);
		}
	},
	{
		mode: 'tokens',
		file: 'src/cart.ts',
		label: 'is neither formatting only nor moved only',
		run: (r) => same(r.file('src/cart.ts').changes, { formattingOnly: false, movedOnly: false })
	},
	{
		mode: 'tokens',
		file: 'src/format.ts',
		label: 'the re-wrap counts as formatting only',
		run: (r) =>
			all(
				same(r.file('src/format.ts').changes?.formattingOnly, true),
				same(
					changed(r, 'src/format.ts').every((l) => l.moved),
					true
				)
			)
	},
	{
		mode: 'tokens',
		file: 'src/format.ts',
		label: "a re-wrap isn't a move, so there's no move label",
		run: (r) =>
			same(
				changed(r, 'src/format.ts').some((l) => l.moveLabel),
				false
			)
	},
	{
		mode: 'tokens',
		file: 'src/label.ts',
		label: 'highlights exactly 1 and 2 after the multi-byte text',
		run: (r) =>
			all(
				same(novel(r.line('src/label.ts', 'del', 'count = 1')), ['1']),
				same(novel(r.line('src/label.ts', 'add', 'count = 2')), ['2'])
			)
	},
	{
		mode: 'tokens',
		file: 'NOTES.txt',
		label: 'highlights the new words',
		run: (r) =>
			all(
				same(novel(r.line('NOTES.txt', 'add', 'Release notes')), ['(draft)']),
				same(novel(r.line('NOTES.txt', 'add', 'Added')), ['line item'])
			)
	},
	{
		mode: 'tokens',
		file: 'src/util.ts',
		label: 'clamp() moving to the bottom is recognised, with labels pointing both ways',
		run: (r) => {
			const removed = r.line('src/util.ts', 'del', 'export function clamp');
			const added = r.line('src/util.ts', 'add', 'export function clamp');
			return all(
				same(removed.moveLabel, `moved to line ${added.new}`),
				same(added.moveLabel, `moved from line ${removed.old}`),
				same(
					changed(r, 'src/util.ts').every((l) => l.moved || !l.text.trim()),
					true
				)
			);
		}
	},
	{
		mode: 'tokens',
		file: 'src/util.ts',
		label: 'counts as moved only, not formatting',
		run: (r) => same(r.file('src/util.ts').changes, { formattingOnly: false, movedOnly: true })
	},
	{
		mode: 'tokens',
		file: 'src/helpers.ts',
		label: 'double() moving out points at src/math.ts',
		run: (r) =>
			same(
				r.line('src/helpers.ts', 'del', 'export function double').moveLabel,
				'moved to src/math.ts:1'
			)
	},
	{
		mode: 'tokens',
		file: 'src/math.ts',
		label: 'double() arriving points back at src/helpers.ts',
		run: (r) =>
			all(
				same(
					r.line('src/math.ts', 'add', 'export function double').moveLabel,
					'moved from src/helpers.ts:1'
				),
				same(r.file('src/math.ts').changes?.movedOnly, true)
			)
	}
];

export type CheckStatus = { status: 'pass' } | { status: 'fail'; detail: string };

export function runCheck(check: Check, result: Result): CheckStatus {
	try {
		const outcome = check.run(result);
		return outcome === true ? { status: 'pass' } : { status: 'fail', detail: outcome };
	} catch (error) {
		return { status: 'fail', detail: error instanceof Error ? error.message : String(error) };
	}
}
