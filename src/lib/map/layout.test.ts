import { expect, test } from 'vitest';
import { fold, layout, merge } from './layout';
import type { MapEdge, MapNode, NodeStatus } from './types';

const node = (
	path: string,
	name: string,
	status: NodeStatus = 'modified',
	extra: Partial<MapNode> = {}
): MapNode => ({
	id: `${path}:${name}`,
	name,
	kind: 'function',
	path,
	line: 1,
	char: 0,
	status,
	hunks: status === 'affected' ? [] : [`h-${name}`],
	...extra
});
const uses = (from: MapNode, to: MapNode, use: MapEdge['use'] = 'call'): MapEdge => ({
	from: from.id,
	to: to.id,
	count: 1,
	added: false,
	use,
	sample: ''
});

test('a test file is one box, and so is a new file, their declarations its members', () => {
	const a = node('src/a.ts', 'a');
	const tests = [node('src/a.test.ts', 't1', 'added'), node('src/a.test.ts', 't2', 'affected')];
	const fresh = [
		node('src/new.ts', 'n0', 'added', { newFile: true }),
		node('src/new.ts', 'n1', 'added', { newFile: true })
	];
	const nodes = fold({ nodes: [a, ...tests, ...fresh], edges: [], notes: [] });
	const boxes = nodes.filter((n) => !n.parent).map((n) => [n.name, n.status, n.folded]);
	expect(boxes).toEqual([
		['a', 'modified', 0],
		['a.test.ts', 'modified', 2],
		['new.ts', 'added', 2]
	]);
	expect(nodes.find((n) => n.name === 'n1')!.parent).toBe('src/new.ts:file');
});

test('uses of a closed box are drawn to it, of an open one to its members', () => {
	const view = node('v.svelte', 'View', 'modified', { kind: 'component', members: true });
	const toggle = node('v.svelte', 'toggle', 'added', { parent: view.id });
	const mark = node('v.svelte', 'mark', 'modified', { parent: view.id });
	const idle = node('v.svelte', 'idle', 'affected', { parent: view.id });
	const page = node('p.svelte', 'Page', 'affected', { kind: 'component' });
	const map = merge(
		{ nodes: [view, page], edges: [uses(page, view, 'render')], notes: [] },
		{ nodes: [toggle, mark, idle], edges: [uses(toggle, mark)], notes: [] }
	);

	const closed = layout(map);
	const byX = [...closed.boxes].sort((a, b) => a.x - b.x);
	expect(byX.map((b) => [b.name, b.rows.length])).toEqual([
		['Page', 0],
		['View', 0]
	]);
	// toggle → mark is inside View, nothing to draw while it's closed
	expect(closed.lines.map((l) => [l.from, l.to, l.use])).toEqual([[page.id, view.id, 'render']]);

	const opened = layout(map, new Set([view.id]));
	const box = opened.boxes.find((b) => b.id === view.id)!;
	expect(box.rows.map((r) => r.name)).toEqual(['toggle', 'mark']);
	// a member nothing shown uses, and the change didn't touch, is only counted
	expect(box.hidden).toBe(1);
	expect(opened.lines.map((l) => [l.from, l.to, l.inner])).toEqual([
		[page.id, view.id, false],
		[toggle.id, mark.id, true]
	]);
});

test('past a few callers of one declaration, the rest are counted, ones using more stay', () => {
	const a = node('src/a.ts', 'a');
	const b = node('src/a.ts', 'b');
	const callers = Array.from({ length: 8 }, (_, i) => node(`src/c${i}.ts`, `c${i}`, 'affected'));
	const { boxes } = layout({
		nodes: [a, b, ...callers],
		edges: [...callers.map((c) => uses(c, a)), uses(callers[7], b)],
		notes: []
	});
	expect(boxes.map((n) => n.name).sort()).toEqual(
		['a', 'b', 'c0', 'c1', 'c2', 'c3', 'c7', '3 more users'].sort()
	);
});

test('past a few things a box uses that nothing else does, the rest are counted', () => {
	const view = node('v.svelte', 'View', 'modified', { kind: 'component' });
	const used = Array.from({ length: 7 }, (_, i) => node(`src/u${i}.ts`, `u${i}`, 'affected'));
	const { boxes, lines } = layout({
		nodes: [view, ...used],
		edges: used.map((u) => uses(view, u, 'import')),
		notes: []
	});
	expect(boxes.map((n) => n.name).sort()).toEqual(
		['View', 'u0', 'u1', 'u2', 'u3', '3 more used'].sort()
	);
	expect(lines.find((l) => l.toBox === `${view.id}:uses`)!.count).toBe(3);
});

test('users sit left of what they use, what is only used sits right, and a cycle lays out', () => {
	const [page, view, helper] = [node('p.ts', 'page'), node('v.ts', 'view'), node('h.ts', 'helper')];
	const lib = node('l.ts', 'lib', 'affected');
	const deeper = node('d.ts', 'deeper', 'affected');
	const { boxes } = layout({
		nodes: [helper, view, page, lib, deeper],
		edges: [
			uses(page, view),
			uses(view, helper),
			uses(page, helper),
			uses(helper, page),
			uses(helper, lib),
			uses(lib, deeper)
		],
		notes: []
	});
	const x = Object.fromEntries(boxes.map((b) => [b.name, b.x]));
	expect(x.view).toBeGreaterThan(x.page);
	expect(x.helper).toBeGreaterThan(x.view);
	expect(x.lib).toBeGreaterThan(x.helper);
	expect(x.deeper).toBeGreaterThan(x.lib);
});

test('a use past a column runs beside the boxes in it, uses of one box meet at one point', () => {
	const [a, b, c] = [node('a.ts', 'a'), node('b.ts', 'b'), node('c.ts', 'c')];
	const d = node('d.ts', 'd');
	const { boxes, lines, heads } = layout({
		nodes: [a, b, c, d],
		edges: [uses(a, b), uses(b, c), uses(a, c), uses(d, b)],
		notes: []
	});
	const box = Object.fromEntries(boxes.map((x) => [x.name, x]));
	// a → c passes b's column beside b, not through it
	const long = lines.find((l) => l.from === a.id && l.to === c.id)!;
	const across = [...long.d.matchAll(/ L([\d.-]+),([\d.-]+)/g)]
		.map((m) => [Number(m[1]), Number(m[2])])
		.filter(([x]) => x === box.b.x + 212);
	expect(across).toHaveLength(1);
	expect(across[0][1] < box.b.y || across[0][1] > box.b.y + box.b.h).toBe(true);

	// both uses of b end at the middle of its left side, under one arrowhead
	const ends = lines.filter((l) => l.to === b.id).map((l) => l.d.split(' L').at(-1));
	expect(ends).toEqual([`${box.b.x},${box.b.y + 23}`, `${box.b.x},${box.b.y + 23}`]);
	const head = heads.find((h) => h.lines.length === 2)!;
	expect([head.x, head.y, head.dir]).toEqual([box.b.x, box.b.y + 23, 1]);
});

test("pressing ‹ on a box that's one of a crowd doesn't show what the crowd counted", () => {
	const view = node('v.svelte', 'View', 'modified', { kind: 'component' });
	const used = Array.from({ length: 8 }, (_, i) => node(`src/u${i}.ts`, `u${i}`, 'affected'));
	const base = {
		nodes: [view, ...used],
		edges: used.map((u) => uses(view, u, 'import')),
		notes: []
	};
	const before = layout(base);
	const shown = before.boxes.filter((b) => b.name.startsWith('u')).map((b) => b.name);
	expect(shown).toHaveLength(4);
	// ‹ on one of them: it gets users of its own, the crowd is counted again
	const caller = node('src/caller.ts', 'caller', 'affected');
	const one = used.find((u) => u.name === shown[0])!;
	const after = layout(
		merge(base, { nodes: [caller], edges: [uses(caller, one)], notes: [] }),
		new Set(),
		before
	);
	const now = after.boxes.filter((b) => b.name.startsWith('u')).map((b) => b.name);
	expect(now.sort()).toEqual([...shown].sort());
	expect(after.boxes.find((b) => b.kind === 'more')!.name).toBe('4 more used');
});

test('groups of boxes linked to nothing in each other sit apart, in bands', () => {
	const [a, b] = [node('a.ts', 'a'), node('b.ts', 'b', 'affected')];
	const [c, d] = [node('c.ts', 'c'), node('d.ts', 'd', 'affected')];
	const lone = node('e.ts', 'e');
	const { groups } = layout({
		nodes: [a, b, c, d, lone],
		edges: [uses(b, a), uses(d, c)],
		notes: []
	});
	expect(groups.map((g) => [g.label, g.lone])).toEqual([
		['a.ts', false],
		['c.ts', false],
		['Linked to nothing else here', true]
	]);
	const sorted = [...groups].sort((p, q) => p.y - q.y);
	for (let i = 1; i < sorted.length; i++) {
		expect(sorted[i].y).toBeGreaterThan(sorted[i - 1].y + sorted[i - 1].h);
	}
});

test('a column is a depth: the longest way down from what nothing uses', () => {
	const [page, view, helper] = [node('p.ts', 'page'), node('v.ts', 'view'), node('h.ts', 'helper')];
	const { boxes, columns } = layout({
		nodes: [helper, view, page],
		edges: [uses(page, view), uses(view, helper), uses(page, helper)],
		notes: []
	});
	const x = Object.fromEntries(boxes.map((b) => [b.name, b.x / (212 + 84)]));
	expect(x).toEqual({ page: 0, view: 1, helper: 2 });
	expect(columns).toBe(3);
});

test("a box's children sit beside it, together, in the order its code uses them", () => {
	const parent = node('p.ts', 'parent');
	const [late, early] = [node('l.ts', 'late'), node('e.ts', 'early')];
	const [other, otherKid] = [node('o.ts', 'other'), node('k.ts', 'otherKid')];
	const at = (e: MapEdge, line: number) => ({ ...e, at: line });
	const { boxes } = layout({
		nodes: [parent, late, early, other, otherKid],
		edges: [
			at(uses(parent, late), 30),
			at(uses(parent, early), 4),
			at(uses(parent, other), 50),
			uses(other, otherKid)
		],
		notes: []
	});
	const y = Object.fromEntries(boxes.map((b) => [b.name, b.y]));
	expect(y.early).toBeLessThan(y.late);
	expect(y.late).toBeLessThan(y.other);
	// the parent beside the middle of its children
	expect(y.parent).toBeGreaterThan(y.early);
	expect(y.parent).toBeLessThan(y.other);
});

test('a box used from two places is drawn once, with the first, the other use lighter', () => {
	const [a, b] = [node('a.ts', 'a'), node('b.ts', 'b')];
	const shared = node('s.ts', 'shared', 'affected');
	const { boxes, lines } = layout({
		nodes: [a, b, shared],
		edges: [uses(a, shared), uses(b, shared)],
		notes: []
	});
	expect(boxes.filter((x) => x.name === 'shared')).toHaveLength(1);
	expect(boxes.find((x) => x.name === 'shared')!.users).toBe(2);
	const secondary = Object.fromEntries(lines.map((l) => [l.from, l.secondary]));
	expect(secondary).toEqual({ [a.id]: false, [b.id]: true });
});

test("uses from one box leave it together and branch, like a tree's", () => {
	const parent = node('p.ts', 'parent');
	const kids = [node('a.ts', 'a'), node('b.ts', 'b'), node('c.ts', 'c')];
	const { lines } = layout({
		nodes: [parent, ...kids],
		edges: kids.map((k) => uses(parent, k)),
		notes: []
	});
	// out of the same point, along the same level run towards the gap, before they part
	const starts = new Set(lines.map((l) => l.d.split(' ')[0]));
	expect(starts.size).toBe(1);
	const y = Number([...starts][0].split(',')[1]);
	for (const l of lines) expect(Number(l.d.split(' ')[1].split(',')[1])).toBe(y);
});

/** the x of a use's turn in the one gap it crosses: its lane */
const laneOf = (d: string) => {
	const points = [...d.matchAll(/([\d.-]+),([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
	return points.slice(1).find((p, i) => points[i][0] === p[0] && points[i][1] !== p[1])?.[0];
};

test("lines from different boxes don't lie on each other, except arriving at one place", () => {
	// q also uses a, which sits beside p: both arrive at a across the same gap
	const [p, q] = [node('p.ts', 'p'), node('q.ts', 'q')];
	const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => node(`${n}.ts`, n));
	const { lines } = layout({
		nodes: [p, q, a, b, c, d],
		edges: [uses(p, a), uses(p, b), uses(q, c), uses(q, d), uses(q, a)],
		notes: []
	});
	const lane = (from: MapNode, to: MapNode) =>
		laneOf(lines.find((l) => l.from === from.id && l.to === to.id)!.d);
	// q's own uses leave together in its lane
	expect(lane(q, c)).toBe(lane(q, d));
	// the two uses of a meet in a lane of a's, apart from q's
	expect(lane(p, a)).toBe(lane(q, a));
	expect(lane(q, a)).not.toBe(lane(q, c));
});

test('uses of one box from many places arrive in one lane, pointed at as one', () => {
	const button = node('Button.svelte', 'Button', 'modified', { kind: 'component' });
	const users = Array.from({ length: 4 }, (_, i) => node(`u${i}.svelte`, `U${i}`));
	const { lines, trunks } = layout({
		nodes: [button, ...users],
		edges: users.map((u) => uses(u, button, 'render')),
		notes: []
	});
	// one may run level with Button, straight in, the others turn in one lane
	const turning = lines.map((l) => laneOf(l.d)).filter((x) => x !== undefined);
	expect(turning.length).toBeGreaterThanOrEqual(3);
	expect(new Set(turning).size).toBe(1);
	const arriving = trunks.find((t) => t.arrives)!;
	expect([arriving.box, arriving.lines.length]).toEqual([button.id, 4]);
});

test('where a trunk parts there is a dot, where lines only cross there is none', () => {
	const parent = node('p.ts', 'parent');
	const kids = [node('a.ts', 'a'), node('b.ts', 'b'), node('c.ts', 'c')];
	const { dots, trunks, boxes } = layout({
		nodes: [parent, ...kids],
		edges: kids.map((k) => uses(parent, k)),
		notes: []
	});
	// the parent sits level with the middle child: one junction, where that one goes on straight
	const middle = boxes.find((b) => b.name === 'parent')!;
	expect(dots).toHaveLength(1);
	expect(dots[0].y).toBe(middle.y + 23);
	expect(trunks).toHaveLength(1);
	expect(trunks[0].lines).toHaveLength(3);
});

test('a box nothing uses sits just left of what it uses, not at the far left', () => {
	const [page, view, helper] = [node('p.ts', 'page'), node('v.ts', 'view'), node('h.ts', 'helper')];
	const caller = node('c.ts', 'caller', 'affected');
	const { boxes } = layout({
		nodes: [page, view, helper, caller],
		edges: [uses(page, view), uses(view, helper), uses(caller, helper)],
		notes: []
	});
	const column = Object.fromEntries(boxes.map((b) => [b.name, b.x / (212 + 84)]));
	expect(column).toEqual({ page: 0, view: 1, helper: 2, caller: 1 });
});
