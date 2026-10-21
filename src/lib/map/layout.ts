import type { ChangeMap, MapEdge, MapNode, NodeStatus, UseKind } from './types';

/** A file whose declarations are more than this, a new one most often, is one box. */
const MAX_PER_FILE = 6;
/** callers of one declaration shown before the rest are counted in one box */
const MAX_USERS = 5;

export const NODE_W = 212;
export const NODE_H = 46;
/** an open box's header, and each member's row under it */
export const HEAD_H = 40;
export const ROW_H = 26;
export const GAP_X = 84;
const GAP_Y = 14;
/** how far a use between two members of one box bows out to its right */
const LOOP = 36;
/** a use's waypoint in a column it passes through */
const WAY_H = 8;
/** a group of boxes linked to each other: room for its name and around it, and between groups */
const BAND_PAD = 14;
const BAND_TOP = 22 + BAND_PAD;
const BAND_GAP = 40;
/** the straight run a loop beside a box ends with, under its arrowhead */
const STUB = 12;
/** how far apart the lanes of different sources are in a gap, as wide as it allows */
const LANE = 6;
/** how round a line's corners are */
const RADIUS = 6;
/** the group of boxes linked to nothing */
const LONE = '';

const TEST = /(\.|_)(test|spec)\.[^/]+$|(^|\/)(tests?|__tests__)\//;

export type Node = MapNode & {
	/** declarations folded into it, or callers counted in it */
	folded: number;
};

export interface Row extends Node {
	/** from the top of its box */
	y: number;
}

export interface Box extends Node {
	x: number;
	y: number;
	h: number;
	open: boolean;
	/** its members the change touched or that use or are used by what's shown, while it's open */
	rows: Row[];
	/** and how many others it has */
	hidden: number;
	/** how many boxes use it */
	users: number;
}

export interface Line {
	/** what's drawn at each end: a box, or a row in an open one */
	from: string;
	to: string;
	fromBox: string;
	toBox: string;
	/** an svg path, and the point halfway along it */
	d: string;
	mid: [number, number];
	count: number;
	added: boolean;
	use: UseKind;
	sample: string;
	/** between two members of one box */
	inner: boolean;
	/** from a box that isn't where this one sits in the tree: it's used from there too */
	secondary: boolean;
	/** where in its user the use is, 1-based, Infinity when that isn't known */
	at: number;
	/** the language server's error there, when it no longer type-checks */
	broken?: string;
}

type Drawn = Omit<Line, 'd' | 'mid' | 'inner' | 'secondary'>;

/** Boxes linked to each other, apart from those that aren't: a band of the map. */
export interface Group {
	x: number;
	y: number;
	w: number;
	h: number;
	label: string;
	/** the boxes linked to nothing */
	lone: boolean;
	/** the boxes in it */
	ids: string[];
}

/** Where a source's lines part, in the gap between two columns. */
export interface Dot {
	x: number;
	y: number;
	owner: string;
	/** the uses in that lane, `from>to` */
	lines: string[];
}

/**
 * Where a box's uses leave it together, before they part, or where uses from several places
 * meet and arrive together: pointed at, they're one
 */
export interface Trunk {
	/** the box they leave, or arrive at */
	box: string;
	arrives: boolean;
	lines: string[];
	/** an svg path along it, to point at */
	d: string;
	/** where they turn into the gap */
	x: number;
	y: number;
}

/** Where uses arrive at one side of a box or a row, all at one point: one arrowhead. */
export interface Head {
	x: number;
	y: number;
	/** 1 pointing right, into a box's left side; -1 pointing left */
	dir: 1 | -1;
	/** every use arriving there is new */
	added: boolean;
	/** the uses arriving, `from>to` */
	lines: string[];
}

export interface Layout {
	boxes: Box[];
	lines: Line[];
	heads: Head[];
	dots: Dot[];
	trunks: Trunk[];
	groups: Group[];
	/** how many columns, each a depth */
	columns: number;
	width: number;
	height: number;
}

const touched = (n: MapNode) => n.status !== 'affected';

/** Maps asked for later laid over the first: a node or a use known twice is one. */
export function merge(...maps: ChangeMap[]): ChangeMap {
	const nodes = new Map<string, MapNode>();
	const edges = new Map<string, MapEdge>();
	for (const map of maps) {
		for (const n of map.nodes) nodes.set(n.id, { ...nodes.get(n.id), ...n });
		for (const e of map.edges) edges.set(`${e.from}>${e.to}`, e);
	}
	return {
		nodes: [...nodes.values()],
		edges: [...edges.values()],
		notes: [...new Set(maps.flatMap((m) => m.notes))]
	};
}

/**
 * Fewer boxes: a test file, a new file and a file with many declarations in the change is
 * one, the declarations its members, to open it into.
 */
export function fold(map: ChangeMap): Node[] {
	const nodes = new Map<string, Node>(map.nodes.map((n) => [n.id, { ...n, folded: 0 }]));
	const tops = map.nodes.filter((n) => !n.parent);
	for (const [path, list] of Map.groupBy(tops, (n) => n.path)) {
		const changed = list.filter(touched);
		const test = TEST.test(path);
		const many =
			changed.length > MAX_PER_FILE || (changed.length > 1 && changed.every((n) => n.newFile));
		const folding = test ? list : many ? changed : [];
		if (folding.length < (test ? 1 : 2)) continue;
		const id = `${path}:file`;
		const status: NodeStatus = folding.every((n) => n.status === 'added')
			? 'added'
			: folding.some(touched)
				? 'modified'
				: 'affected';
		nodes.set(id, {
			id,
			name: path.split('/').pop()!,
			kind: test ? 'tests' : 'file',
			path,
			line: 1,
			char: 0,
			status,
			hunks: folding.flatMap((n) => n.hunks),
			members: true,
			...(folding.some((n) => n.signature) && { signature: true as const }),
			...(folding.some((n) => n.plus !== undefined) && {
				plus: folding.reduce((sum, n) => sum + (n.plus ?? 0), 0),
				minus: folding.reduce((sum, n) => sum + (n.minus ?? 0), 0)
			}),
			folded: folding.length
		});
		for (const n of folding) nodes.set(n.id, { ...nodes.get(n.id)!, parent: id });
	}
	return [...nodes.values()];
}

/**
 * The map as a tree, left to right: what nothing on it uses on the left, each box a
 * column past the furthest box using it, so a column is a depth. Down each column the
 * boxes follow the tree, a box's children together beside it in the order its code uses
 * them, a box used from several places beside the first. Groups of boxes linked to each
 * other are laid out apart, one under another. An open box lists its members, and the
 * uses of them start and end at their rows.
 */
export function layout(
	map: ChangeMap,
	open: ReadonlySet<string> = new Set(),
	/** the layout before this one: a crowd keeps what it showed and what it counted */
	prev?: Layout
): Layout {
	const nodes = fold(map);
	const byId = new Map(nodes.map((n) => [n.id, n]));
	/** the node, its parent, and so on up to the box it's in */
	const chain = (id: string) => {
		const list = [byId.get(id)!];
		while (list.at(-1)!.parent && byId.has(list.at(-1)!.parent!)) {
			list.push(byId.get(list.at(-1)!.parent!)!);
		}
		return list;
	};

	// each use drawn between what's shown of its ends
	const ends = new Map<string, { anchor: string; box: string }>();
	const endOf = (id: string) => {
		let end = ends.get(id);
		if (!end) {
			const c = chain(id);
			const box = c.at(-1)!.id;
			end = { anchor: open.has(box) && c.length > 1 ? c.at(-2)!.id : box, box };
			ends.set(id, end);
		}
		return end;
	};
	const drawn = new Map<string, Drawn>();
	for (const e of map.edges) {
		if (!byId.has(e.from) || !byId.has(e.to)) continue;
		const [a, b] = [endOf(e.from), endOf(e.to)];
		if (a.anchor === b.anchor || (a.box === b.box && !open.has(a.box))) continue;
		const key = `${a.anchor}>${b.anchor}`;
		const had = drawn.get(key);
		if (had) {
			had.count += e.count;
			had.added ||= e.added;
			had.at = Math.min(had.at, e.at ?? Infinity);
			had.broken ??= e.broken;
		} else {
			drawn.set(key, {
				from: a.anchor,
				to: b.anchor,
				fromBox: a.box,
				toBox: b.box,
				count: e.count,
				added: e.added,
				use: e.use,
				sample: e.sample,
				at: e.at ?? Infinity,
				...(e.broken && { broken: e.broken })
			});
		}
	}
	let lines = [...drawn.values()];

	// boxes, and past a few unchanged ones linked to nothing but one box, on one side of
	// it, the rest counted: callers of a declaration, or what a component imports
	const boxes = new Map<string, Node>();
	for (const n of nodes) if (!n.parent || !byId.has(n.parent)) boxes.set(n.id, n);
	const between = (list: typeof lines) => list.filter((l) => l.fromBox !== l.toBox);
	const prevIds = new Set(prev?.boxes.map((b) => b.id));
	for (const users of [true, false]) {
		const links = between(lines);
		const outs = Map.groupBy(links, (l) => (users ? l.fromBox : l.toBox));
		const ins = Map.groupBy(links, (l) => (users ? l.toBox : l.fromBox));
		const other = (l: Drawn) => (users ? l.toBox : l.fromBox);
		const lone = [...boxes.values()].filter(
			(b) =>
				b.status === 'affected' &&
				!open.has(b.id) &&
				!ins.has(b.id) &&
				new Set((outs.get(b.id) ?? []).map(other)).size === 1
		);
		for (const [near, crowd] of Map.groupBy(lone, (b) => other(outs.get(b.id)![0]))) {
			const id = `${near}:${users ? 'users' : 'uses'}`;
			// after the first layout a crowd keeps what it showed and what it counted: new ones
			// fill what room's left, or join the count, and nothing counted is shown by a recount
			let rest = crowd.slice(MAX_USERS - 1);
			if (prev) {
				const counted = prevIds.has(id);
				const shown = crowd.filter((b) => prevIds.has(b.id));
				const room = counted ? 0 : Math.max(0, MAX_USERS - 1 - shown.length);
				rest = crowd.filter((b) => !prevIds.has(b.id)).slice(room);
				if (!counted && rest.length < 2) continue;
			} else if (crowd.length <= MAX_USERS) continue;
			if (!rest.length) continue;
			const gone = new Set(rest.map((b) => b.id));
			boxes.set(id, {
				id,
				name: `${rest.length} more ${users ? 'users' : 'used'}`,
				kind: 'more',
				path: `${new Set(rest.map((b) => b.path)).size} files`,
				line: 0,
				char: 0,
				status: 'affected',
				hunks: [],
				folded: rest.length
			});
			for (const r of gone) boxes.delete(r);
			const side = (l: Drawn) => (users ? l.fromBox : l.toBox);
			const merged = lines.filter((l) => gone.has(side(l)));
			lines = lines.filter((l) => !gone.has(side(l)));
			lines.push({
				...merged[0],
				...(users ? { from: id, fromBox: id } : { to: id, toBox: id }),
				count: merged.reduce((n, l) => n + l.count, 0),
				added: merged.some((l) => l.added)
			});
		}
	}

	const links = between(lines);

	// sizes
	const members = Map.groupBy(
		nodes.filter((n) => n.parent && open.has(n.parent)),
		(n) => n.parent!
	);
	const linked = new Set(lines.flatMap((l) => [l.from, l.to]));
	const sized = new Map<string, Omit<Box, 'x' | 'y'>>();
	for (const n of boxes.values()) {
		if (!open.has(n.id)) {
			sized.set(n.id, { ...n, h: NODE_H, open: false, rows: [], hidden: 0, users: 0 });
			continue;
		}
		const all = members.get(n.id) ?? [];
		const rows = all
			.filter((m) => touched(m) || linked.has(m.id))
			.sort((a, b) => a.line - b.line || a.char - b.char)
			.map((m, i) => ({ ...m, y: HEAD_H + i * ROW_H }));
		const hidden = all.length - rows.length;
		const h = HEAD_H + (rows.length + (hidden ? 1 : 0)) * ROW_H + 6;
		sized.set(n.id, { ...n, h, open: true, rows, hidden, users: 0 });
	}

	// how many boxes use each
	for (const [to, users] of Map.groupBy(links, (l) => l.toBox)) {
		const box = sized.get(to);
		if (box) box.users = new Set(users.map((l) => l.fromBox)).size;
	}

	// groups: boxes linked to each other, those linked to nothing one group of their own
	const groupOf = new Map<string, string>();
	{
		const parent = new Map([...boxes.keys()].map((id) => [id, id]));
		const find = (id: string): string => {
			while (parent.get(id) !== id) id = parent.get(id)!;
			return id;
		};
		for (const l of links) {
			if (parent.has(l.fromBox) && parent.has(l.toBox)) parent.set(find(l.fromBox), find(l.toBox));
		}
		for (const ids of Map.groupBy([...boxes.keys()], find).values()) {
			for (const id of ids) groupOf.set(id, ids.length > 1 ? find(id) : LONE);
		}
	}
	const changedIn = (ids: string[]) => ids.filter((id) => touched(boxes.get(id)!)).length;
	const byPlace = (a: string, b: string) =>
		boxes.get(a)!.path.localeCompare(boxes.get(b)!.path) || boxes.get(a)!.line - boxes.get(b)!.line;

	// where everything goes: each box's column and top, each waypoint's, a box's place in the tree
	const col = new Map<string, number>();
	const ys = new Map<string, number>();
	const tree = new Map<string, string>();
	/** a use between boxes more than a column apart: the waypoints it passes through, in order */
	const routes = new Map<string, string[]>();

	/**
	 * One group as a tree. Its roots are what nothing in it uses, the changed first; a loop
	 * that nothing outside uses gets one of its boxes as a root.
	 */
	function treeBand(ids: string[]) {
		const inBand = new Set(ids);
		const kids = new Map<string, string[]>();
		const ups = new Map<string, string[]>();
		const at = new Map<string, number>();
		for (const l of links) {
			if (!inBand.has(l.fromBox) || !inBand.has(l.toBox)) continue;
			const key = `${l.fromBox}>${l.toBox}`;
			if (!at.has(key)) {
				(kids.get(l.fromBox) ?? kids.set(l.fromBox, []).get(l.fromBox)!).push(l.toBox);
				(ups.get(l.toBox) ?? ups.set(l.toBox, []).get(l.toBox)!).push(l.fromBox);
			}
			at.set(key, Math.min(at.get(key) ?? Infinity, l.at));
		}
		// a box's children in the order its code uses them
		for (const [from, list] of kids) {
			list.sort((a, b) => at.get(`${from}>${a}`)! - at.get(`${from}>${b}`)! || byPlace(a, b));
		}
		const order = [...ids].sort(
			(a, b) => Number(touched(boxes.get(b)!)) - Number(touched(boxes.get(a)!)) || byPlace(a, b)
		);
		const roots = order.filter((id) => !ups.has(id));
		// the uses that close a loop, left out of the depths
		const state = new Map<string, 'open' | 'done'>();
		const back = new Set<string>();
		const visit = (n: string) => {
			state.set(n, 'open');
			for (const k of kids.get(n) ?? []) {
				if (state.get(k) === 'open') back.add(`${n}>${k}`);
				else if (!state.has(k)) visit(k);
			}
			state.set(n, 'done');
		};
		for (const r of roots) visit(r);
		// a loop nothing outside uses starts from its most entry-like box: using most, used least
		const outward = (id: string) => (kids.get(id)?.length ?? 0) - (ups.get(id)?.length ?? 0);
		for (const id of [...order].sort((a, b) => outward(b) - outward(a))) {
			if (state.has(id)) continue;
			roots.push(id);
			visit(id);
		}
		const forward = (from: string, to: string) => !back.has(`${from}>${to}`);

		// a column is a depth: the longest path from a root
		const depth = new Map<string, number>();
		const depthOf = (n: string): number => {
			let d = depth.get(n);
			if (d === undefined) {
				const from = (ups.get(n) ?? []).filter((u) => forward(u, n));
				d = Math.max(-1, ...from.map(depthOf)) + 1;
				depth.set(n, d);
			}
			return d;
		};
		for (const id of ids) depthOf(id);
		// a box nothing here uses sits just left of the nearest it uses, not at the far left, so
		// an unchanged caller's line to what changed is short
		for (const r of ids) {
			if (ups.has(r)) continue;
			const next = (kids.get(r) ?? []).filter((k) => forward(r, k)).map((k) => depth.get(k)!);
			if (next.length) depth.set(r, Math.max(0, Math.min(...next) - 1));
		}
		for (const id of ids) col.set(id, depth.get(id)!);

		// down the tree: a box's children placed first, in one block, the box beside their
		// middle; a box with none under everything placed so far. A box used from several
		// places goes with the first to reach it
		const floor = new Map<number, number>();
		let cursor = 0;
		const seen = new Set<string>();
		const place = (n: string) => {
			const mine = (kids.get(n) ?? []).filter((k) => forward(n, k) && !seen.has(k));
			for (const k of mine) {
				seen.add(k);
				tree.set(k, n);
			}
			for (const k of mine) place(k);
			const h = sized.get(n)!.h;
			const c = depth.get(n)!;
			const last = mine.at(-1);
			const want = last
				? (ys.get(mine[0])! + ys.get(last)! + sized.get(last)!.h) / 2 - h / 2
				: cursor;
			const y = Math.max(want, floor.get(c) ?? 0);
			ys.set(n, y);
			floor.set(c, y + h + GAP_Y);
			cursor = Math.max(cursor, y + h + GAP_Y);
		};
		for (const r of roots) {
			if (seen.has(r)) continue;
			seen.add(r);
			place(r);
		}
		ways(ids);
	}

	/** Boxes linked to nothing, `per` to a row, as a grid. */
	function gridBand(ids: string[], per: number) {
		const floor = new Map<number, number>();
		[...ids].sort(byPlace).forEach((id, i) => {
			const c = i % per;
			col.set(id, c);
			ys.set(id, floor.get(c) ?? 0);
			floor.set(c, ys.get(id)! + sized.get(id)!.h + GAP_Y);
		});
	}

	/**
	 * A use between boxes more than a column apart passes through a waypoint in each column
	 * between, in the free space nearest a straight line between its ends.
	 */
	function ways(ids: string[]) {
		const inBand = new Set(ids);
		const taken = new Map<number, [number, number][]>();
		for (const id of ids) {
			const c = col.get(id)!;
			(taken.get(c) ?? taken.set(c, []).get(c)!).push([
				ys.get(id)!,
				ys.get(id)! + sized.get(id)!.h
			]);
		}
		const centre = (id: string) => ys.get(id)! + (sized.get(id)?.h ?? WAY_H) / 2;
		for (const l of links) {
			const key = `${l.fromBox}>${l.toBox}`;
			if (!inBand.has(l.fromBox) || routes.has(key)) continue;
			const [a, b] = [col.get(l.fromBox)!, col.get(l.toBox)!];
			const step = b > a ? 1 : -1;
			const way: string[] = [];
			for (let c = a + step; a !== b && c !== b; c += step) {
				const id = `${key}@${c}`;
				const t = (c - a) / (b - a);
				const want = centre(l.fromBox) + (centre(l.toBox) - centre(l.fromBox)) * t - WAY_H / 2;
				const busy = [...(taken.get(c) ?? [])].sort((p, q) => p[0] - q[0]);
				let [best, off, above] = [want, Infinity, -Infinity];
				for (const [top, bottom] of [...busy, [Infinity, Infinity]]) {
					const [lo, hi] = [above + GAP_Y / 2, top - GAP_Y / 2 - WAY_H];
					if (hi >= lo) {
						const y = Math.min(Math.max(want, lo), hi);
						if (Math.abs(y - want) < off) [best, off] = [y, Math.abs(y - want)];
					}
					above = Math.max(above, bottom);
				}
				col.set(id, c);
				ys.set(id, best);
				(taken.get(c) ?? taken.set(c, []).get(c)!).push([best, best + WAY_H]);
				way.push(id);
			}
			routes.set(key, way);
		}
	}

	// each group laid out by itself, under the one before: the biggest changes first, the
	// boxes linked to nothing last, as a grid as wide as the widest group
	const parts = Map.groupBy([...boxes.keys()], (id) => groupOf.get(id)!);
	const lone = parts.get(LONE) ?? [];
	parts.delete(LONE);
	const bands = [...parts.values()].sort(
		(a, b) => changedIn(b) - changedIn(a) || b.length - a.length
	);
	let top = BAND_TOP;
	let widest = 1;
	const stack = (ids: string[], lay: () => void) => {
		const before = new Set(ys.keys());
		lay();
		const placed = [...ys.keys()].filter((id) => !before.has(id));
		const least = Math.min(...placed.map((id) => ys.get(id)!));
		const most = Math.max(...placed.map((id) => ys.get(id)! + (sized.get(id)?.h ?? WAY_H)));
		for (const id of placed) ys.set(id, ys.get(id)! - least + top);
		top += most - least + BAND_PAD + BAND_GAP + BAND_TOP;
		widest = Math.max(widest, ...ids.map((id) => col.get(id)! + 1));
	};
	for (const ids of bands) stack(ids, () => treeBand(ids));
	if (lone.length) stack(lone, () => gridBand(lone, Math.max(2, widest)));

	const W = NODE_W + GAP_X;
	const placed: Box[] = [...boxes.keys()].map((id) => ({
		...sized.get(id)!,
		x: col.get(id)! * W,
		y: ys.get(id)!
	}));
	const at = new Map(placed.map((b) => [b.id, b]));

	// every use leaving, or arriving at, one side of a box or a row does so at one point,
	// its middle. Between columns a use runs at right angles: out of its box, along the gap
	// to where it's going, across. Uses from one box share the way out and branch like a
	// tree; uses to one box meet on the way in
	const yOf = (anchor: string, box: string) => {
		const b = at.get(box)!;
		const r = anchor === box ? null : b.rows.find((m) => m.id === anchor);
		return r ? b.y + r.y + ROW_H / 2 : b.y + (b.open ? HEAD_H : NODE_H) / 2;
	};
	// the gaps a use between columns crosses: in each it runs up or down from the height it
	// comes in at to the one it goes on at, in its source's lane
	interface Run {
		line: number;
		/** twice the column on its left, and one */
		gap: number;
		/** whose lane it runs in: its source's, or where it arrives, `→` and that */
		owner: string;
		/** it's the run into where the use arrives */
		last: boolean;
		from: number;
		to: number;
	}
	const runs: Run[] = [];
	const plans = lines.map((l, i) => {
		const [a, b] = [col.get(l.fromBox)!, col.get(l.toBox)!];
		if (a === b) return null;
		const dir = b > a ? 1 : -1;
		const way = routes.get(`${l.fromBox}>${l.toBox}`) ?? [];
		const heights = [yOf(l.from, l.fromBox)];
		for (let c = a, k = 0; c !== b; c += dir, k++) {
			const next = c + dir === b ? yOf(l.to, l.toBox) : ys.get(way[k])! + WAY_H / 2;
			runs.push({
				line: i,
				gap: 2 * Math.min(c, c + dir) + 1,
				owner: l.fromBox,
				last: c + dir === b,
				from: heights.at(-1)!,
				to: next
			});
			heights.push(next);
		}
		return { a, b, dir, heights };
	});

	// into a place more than one use reaches across the same gap, they come in its lane and
	// meet before it, the way one source's uses leave together
	const arriving = Map.groupBy(
		runs.filter((r) => r.last),
		(r) => `${r.gap}|${lines[r.line].to}`
	);
	for (const r of runs) {
		if (r.last && arriving.get(`${r.gap}|${lines[r.line].to}`)!.length > 1) {
			r.owner = `→${lines[r.line].to}`;
		}
	}
	const ownerOf = new Map(runs.map((r) => [`${r.line}|${r.gap}`, r.owner]));

	// a lane for each source in each gap, so lines from different places never lie on each
	// other; two sources share one where their runs don't overlap. Lanes are LANE apart,
	// closer when a gap needs many
	const lane = new Map<string, number>();
	for (const [gap, inGap] of Map.groupBy(runs, (r) => r.gap)) {
		const spans = [...Map.groupBy(inGap, (r) => r.owner)]
			.map(([owner, rs]) => {
				const heights = rs.flatMap((r) => [r.from, r.to]);
				return { owner, lo: Math.min(...heights), hi: Math.max(...heights), start: rs[0].from };
			})
			.sort((p, q) => p.lo - q.lo || p.start - q.start);
		const ends: number[] = [];
		const index = new Map<string, number>();
		for (const span of spans) {
			let i = ends.findIndex((end) => end + LANE < span.lo);
			if (i < 0) i = ends.push(-Infinity) - 1;
			ends[i] = span.hi;
			index.set(span.owner, i);
		}
		const middle = ((gap - 1) / 2) * W + NODE_W + GAP_X / 2;
		const step = Math.min(LANE, (GAP_X - 32) / Math.max(1, ends.length - 1));
		for (const [owner, i] of index) {
			lane.set(`${gap}|${owner}`, middle + (i - (ends.length - 1) / 2) * step);
		}
	}

	const shaped: Line[] = lines.map((l, i) => {
		const secondary = l.fromBox !== l.toBox && tree.get(l.toBox) !== l.fromBox;
		const plan = plans[i];
		if (!plan) {
			// a loop out of the right side and back into it
			const [ya, yb] = [yOf(l.from, l.fromBox), yOf(l.to, l.toBox)];
			const [x1, x2] = [at.get(l.fromBox)!.x + NODE_W, at.get(l.toBox)!.x + NODE_W];
			return {
				...l,
				inner: l.fromBox === l.toBox,
				secondary,
				d: `M${x1},${ya} C${x1 + LOOP},${ya} ${x2 + LOOP},${yb} ${x2 + STUB},${yb} L${x2},${yb}`,
				mid: [x1 + (LOOP * 3) / 4, (ya + yb) / 2]
			};
		}
		const { a, b, dir, heights } = plan;
		const points: [number, number][] = [[a * W + (dir > 0 ? NODE_W : 0), heights[0]]];
		const spines: [number, number][] = [];
		for (let c = a, k = 0; c !== b; c += dir, k++) {
			const gap = 2 * Math.min(c, c + dir) + 1;
			const x = lane.get(`${gap}|${ownerOf.get(`${i}|${gap}`)}`)!;
			const [y0, y1] = [heights[k], heights[k + 1]];
			points.push([x, y0], [x, y1]);
			spines.push([x, (y0 + y1) / 2]);
			if (c + dir !== b) {
				const cx = (c + dir) * W;
				points.push(dir > 0 ? [cx, y1] : [cx + NODE_W, y1], dir > 0 ? [cx + NODE_W, y1] : [cx, y1]);
			}
		}
		points.push([b * W + (dir > 0 ? 0 : NODE_W), heights.at(-1)!]);
		return {
			...l,
			inner: false,
			secondary,
			d: rounded(points),
			mid: spines[Math.floor(spines.length / 2)]
		};
	});

	// where a source's lines part in a gap, a dot, as on a transit map: no dot, they only
	// cross. Where they leave its box together, the trunk, to point at as one
	const dots: Dot[] = [];
	const trunks: Trunk[] = [];
	for (const [at_, rs] of Map.groupBy(runs, (r) => `${r.gap}|${r.owner}`)) {
		if (rs.length < 2) continue;
		const x = lane.get(at_)!;
		const owner = rs[0].owner;
		const keys = rs.map((r) => `${lines[r.line].from}>${lines[r.line].to}`);
		const heights = rs.flatMap((r) => [r.from, r.to]);
		const [lo, hi] = [Math.min(...heights), Math.max(...heights)];
		const starts = new Set(rs.map((r) => r.from));
		for (const y of new Set(heights)) {
			const inside = lo < y && y < hi;
			// at an end of the run, where one goes straight on and another turns
			const level = starts.has(y) && rs.some((r) => r.to === y) && rs.some((r) => r.to !== y);
			if (inside || level) dots.push({ x, y, owner, lines: keys });
		}
		const gap = rs[0].gap;
		if (owner.startsWith('→')) {
			// the uses arriving together: the lane they meet in, and the run on into the box
			const to = lines[rs[0].line];
			const box = at.get(to.toBox)!;
			const y = rs[0].to;
			const edge = gap < 2 * col.get(to.toBox)! ? box.x : box.x + NODE_W;
			trunks.push({
				box: to.toBox,
				arrives: true,
				lines: keys,
				d: `M${x},${lo} L${x},${hi} M${x},${y} L${edge},${y}`,
				x,
				y
			});
			continue;
		}
		const side =
			gap === 2 * col.get(owner)! + 1 ? 'right' : gap === 2 * col.get(owner)! - 1 ? 'left' : null;
		if (side && starts.size === 1) {
			const box = at.get(owner)!;
			const from = rs[0].from;
			const edge = side === 'right' ? box.x + NODE_W : box.x;
			trunks.push({
				box: owner,
				arrives: false,
				lines: keys,
				d: `M${edge},${from} L${x},${from} M${x},${lo} L${x},${hi}`,
				x,
				y: from
			});
		}
	}

	// one arrowhead where uses arrive
	const heads = new Map<string, Head>();
	for (const l of shaped) {
		const end = l.d
			.slice(l.d.lastIndexOf('L') + 1)
			.split(',')
			.map(Number);
		const dir = col.get(l.toBox)! > col.get(l.fromBox)! ? 1 : -1;
		const key = `${l.to}|${dir}`;
		const head =
			heads.get(key) ??
			heads.set(key, { x: end[0], y: end[1], dir, added: true, lines: [] }).get(key)!;
		head.added &&= l.added;
		head.lines.push(`${l.from}>${l.to}`);
	}

	// a band behind each group, named by the files of what changed in it
	const groups: Group[] = [];
	if (parts.size + (lone.length ? 1 : 0) > 1) {
		for (const [g, ids] of [...parts, ...(lone.length ? [[LONE, lone] as const] : [])]) {
			const bs = ids.map((id) => at.get(id)!);
			const wayYs = bs.flatMap((b) =>
				[...routes]
					.filter(([key]) => key.startsWith(`${b.id}>`))
					.flatMap(([, way]) => way.map((id) => ys.get(id)!))
			);
			const top = Math.min(...bs.map((b) => b.y), ...wayYs) - BAND_TOP;
			const bottom =
				Math.max(...bs.map((b) => b.y + b.h), ...wayYs.map((y) => y + WAY_H)) + BAND_PAD;
			const left = Math.min(...bs.map((b) => b.x)) - BAND_PAD;
			const right = Math.max(...bs.map((b) => b.x + NODE_W)) + LOOP;
			const files = [...new Set(bs.filter(touched).map((b) => b.path.split('/').pop()!))];
			const named =
				files.slice(0, 3).join(' · ') + (files.length > 3 ? ` +${files.length - 3}` : '');
			groups.push({
				x: left,
				y: top,
				w: right - left,
				h: bottom - top,
				lone: g === LONE,
				ids,
				label: g === LONE ? 'Linked to nothing else here' : named || bs[0].path
			});
		}
	}

	const columns = Math.max(0, ...col.values()) + 1;
	return {
		boxes: placed,
		lines: shaped,
		heads: [...heads.values()],
		dots,
		trunks,
		groups,
		columns,
		width: columns * W - GAP_X + LOOP,
		height: Math.max(0, top - BAND_GAP - BAND_TOP)
	};
}

/** A path through `points`, each a right angle, its corners rounded. */
export function rounded(points: [number, number][]): string {
	const p = points.filter(
		(q, i) => i === 0 || q[0] !== points[i - 1][0] || q[1] !== points[i - 1][1]
	);
	const toward = (from: [number, number], to: [number, number], by: number) => {
		const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
		return [from[0] + ((to[0] - from[0]) * by) / len, from[1] + ((to[1] - from[1]) * by) / len];
	};
	let d = `M${p[0][0]},${p[0][1]}`;
	for (let i = 1; i < p.length - 1; i++) {
		const [a, b, c] = [p[i - 1], p[i], p[i + 1]];
		const turns = (a[1] === b[1]) !== (b[1] === c[1]);
		const r = Math.min(
			RADIUS,
			Math.hypot(b[0] - a[0], b[1] - a[1]) / 2,
			Math.hypot(c[0] - b[0], c[1] - b[1]) / 2
		);
		if (!turns || r < 0.5) {
			d += ` L${b[0]},${b[1]}`;
			continue;
		}
		const [p1, p2] = [toward(b, a, r), toward(b, c, r)];
		d += ` L${p1[0]},${p1[1]} Q${b[0]},${b[1]} ${p2[0]},${p2[1]}`;
	}
	const last = p.at(-1)!;
	return `${d} L${last[0]},${last[1]}`;
}
