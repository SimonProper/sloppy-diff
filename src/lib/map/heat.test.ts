import { expect, test } from 'vitest';
import { heatOf, ranked } from './heat';
import { layout } from './layout';
import { mix, THEMES } from '$lib/themes/themes';
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
const uses = (from: MapNode, to: MapNode, extra: Partial<MapEdge> = {}): MapEdge => ({
	from: from.id,
	to: to.id,
	count: 1,
	added: false,
	use: 'call',
	sample: '',
	...extra
});
const heated = (nodes: MapNode[], edges: MapEdge[]) => {
	const { boxes, lines } = layout({ nodes, edges, notes: [] });
	const { heat, warm } = heatOf(boxes, lines);
	const level = (n: MapNode) => heat.get(n.id)?.level ?? 0;
	return { heat, warm, level };
};

test('a use that no longer type-checks: attention on the caller and on what it calls', () => {
	const changed = node('lib.ts', 'parse', 'modified', { signature: true });
	const caller = node('page.ts', 'load', 'affected');
	const { heat, warm, level } = heated(
		[changed, caller],
		[uses(caller, changed, { broken: 'Expected 2 arguments, but got 1.' })]
	);
	expect([level(changed), level(caller)]).toEqual([2, 2]);
	expect(heat.get(caller.id)!.reasons[0]).toEqual({
		level: 2,
		text: 'Its use of parse no longer type-checks: Expected 2 arguments, but got 1.',
		ids: [changed.id]
	});
	expect([...warm]).toEqual([`${caller.id}>${changed.id}`]);
});

test('an outside changed with users and no test: attention; its callers that still compile: a look', () => {
	const changed = node('lib.ts', 'parse', 'modified', { signature: true });
	const caller = node('page.ts', 'load', 'affected');
	const { heat, level } = heated([changed, caller], [uses(caller, changed)]);
	expect(heat.get(changed.id)!.reasons.map((r) => r.text)).toEqual([
		'Signature changed, 1 user, no test'
	]);
	expect(level(changed)).toBe(2);
	expect(heat.get(caller.id)!.reasons.map((r) => [r.level, r.text])).toEqual([
		[1, "parse's signature changed, this use wasn't"]
	]);
});

test('with a test it is a look, and a test left as it was says so', () => {
	const changed = node('lib.ts', 'parse', 'modified', { signature: true });
	const caller = node('page.ts', 'load', 'affected');
	const spec = node('lib.test.ts', 'parses', 'affected');
	const { heat, level } = heated(
		[changed, caller, spec],
		[uses(caller, changed), uses(spec, changed)]
	);
	expect(level(changed)).toBe(1);
	expect(heat.get(changed.id)!.reasons.map((r) => r.text)).toEqual([
		'Signature changed, 1 user',
		'Its test is unchanged'
	]);
});

test('a change inside a body only, with few users, is quiet', () => {
	const changed = node('lib.ts', 'parse');
	const caller = node('page.ts', 'load', 'affected');
	const { heat } = heated([changed, caller], [uses(caller, changed)]);
	expect(heat.size).toBe(0);
});

test('the boxes to look at first: attention, then a look', () => {
	const a = node('a.ts', 'a', 'modified', { signature: true });
	const b = node('b.ts', 'b', 'modified', { signature: true });
	const [ua, ub] = [node('ua.ts', 'ua', 'affected'), node('ub.ts', 'ub', 'affected')];
	const spec = node('b.test.ts', 'tb', 'modified');
	const { heat } = heated([a, b, ua, ub, spec], [uses(ua, a), uses(ub, b), uses(spec, b)]);
	expect(ranked(heat).slice(0, 1)).toEqual([a.id]);
});

// the map's --heat: the theme's red pulled a little towards its text, so it stands out from
// the fills in every theme, light or dark
test('the heat bar stands out on every box in every theme', () => {
	const luminance = (hex: string) => {
		const [r, g, b] = [1, 3, 5].map((i) => {
			const c = parseInt(hex.slice(i, i + 2), 16) / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const contrast = (a: string, b: string) => {
		const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
		return (x + 0.05) / (y + 0.05);
	};
	const low: string[] = [];
	for (const { id, roles } of THEMES) {
		// an unchanged box's fill, and an added or modified one's tint over the canvas
		const fills = {
			surface: roles.surface,
			add: mix(roles.add, roles.canvas, 0.12),
			mod: mix(roles.mod, roles.canvas, 0.12)
		};
		for (const [fill, colour] of Object.entries(fills)) {
			const ratio = contrast(mix(roles.del, roles.fg, 0.7), colour);
			if (ratio < 3) low.push(`${id} on ${fill}: ${ratio.toFixed(2)}`);
		}
	}
	expect(low).toEqual([]);
});
