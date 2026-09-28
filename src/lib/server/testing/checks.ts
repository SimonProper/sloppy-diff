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

const FILES = ['src/cart.ts', 'src/format.ts', 'src/label.ts', 'NOTES.txt', 'src/util.ts'];

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
			if (lines.some((l) => l.reformatted)) return 'a line is marked as reformatted';
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
		label: 'describe() moving to the top is a removal and an addition',
		run: (r) => {
			const added = r.line('src/cart.ts', 'add', 'export function describe');
			const removed = r.line('src/cart.ts', 'del', 'export function describe');
			return all(same(added.reformatted, undefined), same(removed.reformatted, undefined));
		}
	},
	{
		mode: 'tokens',
		file: 'src/cart.ts',
		label: 'is not formatting only',
		run: (r) => same(r.file('src/cart.ts').changes, { formattingOnly: false })
	},
	{
		mode: 'tokens',
		file: 'src/format.ts',
		label: 'the re-wrap counts as formatting only',
		run: (r) =>
			all(
				same(r.file('src/format.ts').changes?.formattingOnly, true),
				same(
					changed(r, 'src/format.ts').every((l) => l.reformatted),
					true
				)
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
		label: 'the re-indented return has nothing new, the if around it is new',
		run: (r) =>
			all(
				same(r.line('src/util.ts', 'del', 'return Math.min').reformatted, true),
				same(r.line('src/util.ts', 'add', 'return Math.min').reformatted, true),
				same(r.line('src/util.ts', 'add', 'Number.isFinite').reformatted, undefined),
				same(r.line('src/util.ts', 'add', 'return min;').reformatted, undefined)
			)
	},
	{
		mode: 'tokens',
		file: 'src/util.ts',
		label: 'is not formatting only',
		run: (r) => same(r.file('src/util.ts').changes, { formattingOnly: false })
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
