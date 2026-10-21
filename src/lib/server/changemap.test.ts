import { describe, expect, test, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: process.env }));
const { importedNames, signatureChanged, useKind } = await import('./changemap');

describe('how a use is read off its line', () => {
	const kind = (line: string, name: string, markup = false) => {
		const start = line.indexOf(name);
		return useKind(line, start, start + name.length, markup);
	};

	test('calls, writes, types and reads', () => {
		expect(kind('	const x = columnsOf(files);', 'columnsOf')).toBe('call');
		expect(kind('	const w = new Where(dir, files);', 'Where')).toBe('call');
		expect(kind('	node.hunks = [];', 'hunks')).toBe('write');
		expect(kind('	node.added ||= true;', 'added')).toBe('read');
		expect(kind('	let files: DiffFile[] = [];', 'DiffFile')).toBe('type');
		expect(kind('	const m = new Map<string, MapNode>();', 'MapNode')).toBe('type');
		expect(kind('export type Line = Omit<MapEdge, "d">;', 'MapEdge')).toBe('type');
		expect(kind('	if (open.has(box)) return;', 'box')).toBe('read');
	});

	test('in markup, a component rendered and a prop passed to it', () => {
		expect(kind('	<FileDiff {file} reviewed={done} />', 'FileDiff', true)).toBe('render');
		expect(kind('	<FileDiff {file} reviewed={done} />', 'reviewed', true)).toBe('prop');
		expect(kind('	<FileDiff {file} reviewed={done} />', 'file', true)).toBe('prop');
		expect(kind('	</SidebarLayout>', 'SidebarLayout', true)).toBe('render');
	});
});

test('the names imports bring in, where each is written, across lines and after `as`', () => {
	const text = [
		"import { tick } from 'svelte';",
		'import {',
		'	layout,',
		'	type Box as Shown',
		"} from '$lib/map/layout';",
		"import FileDiff from './FileDiff.svelte';",
		'const x = 1;'
	];
	const names = importedNames(text).map((p) => text[p.line].slice(p.character).match(/^\w+/)![0]);
	expect(names).toEqual(['tick', 'layout', 'Shown', 'FileDiff']);
});

describe("whether a change touches a declaration's outside, what its users see", () => {
	const at = (line: number, character = 0) => ({ line, character });
	const symbol = (
		kind: number,
		start: number,
		end: number,
		name = 'f',
		children: never[] = []
	) => ({
		name,
		kind,
		range: { start: at(start), end: at(end) },
		selectionRange: { start: at(start, 0), end: at(start, 1) },
		children
	});

	test('a function: its parameters and type are outside, over several lines too, its body inside', () => {
		const text = [
			'export function changeMap(',
			'	root: string,',
			'	files: DiffFile[]',
			'): Promise<ChangeMap> {',
			'	const map = new Map();',
			'	return map;',
			'}'
		];
		const f = symbol(12, 0, 6);
		expect(signatureChanged(f, [2], text)).toBe(true);
		expect(signatureChanged(f, [3], text)).toBe(true);
		expect(signatureChanged(f, [4, 5], text)).toBe(false);
	});

	test('an arrow function, its destructured parameters outside', () => {
		const text = ['const label = ({ name, kind }: Box) =>', '	`${kind} ${name}`;'];
		const f = symbol(13, 0, 1);
		expect(signatureChanged(f, [0], text)).toBe(true);
		expect(signatureChanged(f, [1], text)).toBe(false);
	});

	test('a type or an interface is all outside, a class its methods outsides', () => {
		expect(
			signatureChanged(symbol(11, 0, 3), [2], ['interface P {', ' a: 1;', ' b: 2;', '}'])
		).toBe(true);
		expect(
			signatureChanged(symbol(13, 0, 2), [1], ['export type Way =', "	| 'users'", "	| 'uses';"])
		).toBe(true);
		const text = ['class Reader {', '	users(target: NodeRef) {', '		return 1;', '	}', '}'];
		const method = symbol(6, 1, 3, 'users');
		const reader = { ...symbol(5, 0, 4, 'Reader'), children: [method] as never[] };
		expect(signatureChanged(reader, [1], text)).toBe(true);
		expect(signatureChanged(reader, [2], text)).toBe(false);
	});

	test("a component's props are its outside", () => {
		const text = [
			'<script lang="ts">',
			'	interface Props {',
			'		open: boolean;',
			'	}',
			'	let { open }: Props = $props();',
			'	let shown = $state(false);',
			'</script>'
		];
		const props = symbol(11, 1, 3, 'Props');
		const view = { ...symbol(-1, 0, 6, 'View.svelte'), children: [props] as never[] };
		expect(signatureChanged(view, [2], text)).toBe(true);
		expect(signatureChanged(view, [4], text)).toBe(true);
		expect(signatureChanged(view, [5], text)).toBe(false);
	});
});

test('the lines a change wrote and took away, each removal at the line before it', async () => {
	const { changedLines } = await import('./changemap');
	const line = (kind: 'ctx' | 'add' | 'del', old: number | null, now: number | null) => ({
		kind,
		text: '',
		old,
		new: now
	});
	const file = {
		hunks: [
			{
				id: 'h1',
				lines: [
					line('ctx', 1, 1),
					line('del', 2, null),
					line('del', 3, null),
					line('add', null, 2),
					line('ctx', 4, 3)
				],
				newStart: 1
			}
		]
	};
	const { added, removed, touched } = changedLines(file as never);
	expect([...added]).toEqual([1]);
	expect([...removed]).toEqual([[0, 2]]);
	expect([...touched.keys()].sort()).toEqual([0, 1]);
});
