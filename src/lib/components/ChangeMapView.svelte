<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import {
		GAP_X,
		HEAD_H,
		layout,
		merge,
		NODE_H,
		NODE_W,
		ROW_H,
		rounded,
		type Line
	} from '$lib/map/layout';
	import { heatOf, ranked, type Heat } from '$lib/map/heat';
	import { mapState } from '$lib/map/state.svelte';
	import { typing } from '$lib/keys';
	import FileDiff from '$lib/components/FileDiff.svelte';
	import LayoutToggle from '$lib/components/LayoutToggle.svelte';
	import { diffWidth } from '$lib/components/SidebarLayout.svelte';
	import { getWholeFile } from '$lib/diff/diff.remote';
	import { columnsOf, findHunk } from '$lib/diff/hunks';
	import type { DiffFile } from '$lib/diff/types';
	import type { Layout } from '$lib/diff/split';
	import { expandChangeMap, getChangeMap } from '$lib/map/map.remote';
	import type { ChangeMap, MapNode, UseKind, Way } from '$lib/map/types';

	interface Props {
		repo: string;
		start: string;
		stop: string;
		/** shows the hunk in the diff */
		onjump: (hunk: string) => void;
		/** the change's files, for what's selected to show its diff beside the map */
		files: DiffFile[];
		layout?: Layout;
	}

	let { repo, start, stop, onjump, files, layout: lines = 'unified' }: Props = $props();

	const PAD = 28;
	// what's been asked and opened, and where the map's looked at, kept for the page's life:
	// a tab switch, like clicking a box to see its diff, comes back to it as it was
	// svelte-ignore state_referenced_locally
	const st = mapState(repo, start, stop);
	const query = $derived(getChangeMap({ repo, start, stop }));
	const map = $derived(query.current ? merge(query.current, ...st.more) : null);
	// laid out again whenever something's added or opened, the last one handed on so a
	// crowd of boxes keeps what it showed
	const drawn = $derived.by(() => {
		if (!map) return null;
		const next = layout(map, st.open, st.previous);
		st.previous = next;
		return next;
	});
	/** after ‹ or ›: what was found, and the boxes it's in, marked for a moment */
	let found = $state('');
	let flash = $state(new Set<string>());
	/** a box or a row the pointer is on, and a use */
	let hovered = $state<string | null>(null);
	let line = $state<Line | null>(null);
	/**
	 * What's said where the pointer is, on the map's own measure: a use's code, where a
	 * trunk's uses go, how many arrive. `left`: it reads to the left of the point
	 */
	let tip = $state<{ x: number; y: number; text: string; left?: boolean } | null>(null);
	/** what's selected, shown beside the map: its hunks, by file, or its code when unchanged */
	const shown = $derived.by(() => {
		// what's drawn first: a test file or a new one is a box the layout folds together, not
		// one of the map's own nodes
		const id = st.selected;
		const box = id ? boxOf(id) : undefined;
		const node =
			(box?.id === id ? box : box?.rows.find((r) => r.id === id)) ??
			(id ? map?.nodes.find((n) => n.id === id) : undefined);
		if (!node) return null;
		const byFile = new Map<DiffFile, string[]>();
		for (const id of node.hunks) {
			const found = findHunk(files, id);
			if (found) (byFile.get(found.file) ?? byFile.set(found.file, []).get(found.file)!).push(id);
		}
		return { node, byFile: [...byFile] };
	});
	/**
	 * The uses inside the file shown beside the map, about what's selected or its members:
	 * from the line a use is on to the line of what it uses, both in that file
	 */
	const within = $derived.by(() => {
		if (!shown || !map) return [];
		const selected = shown.node.id;
		const near = new Set([
			selected,
			...map.nodes.filter((n) => n.parent === selected).map((n) => n.id)
		]);
		const byId = new Map(map.nodes.map((n) => [n.id, n]));
		return map.edges.flatMap((e) => {
			const [from, to] = [byId.get(e.from), byId.get(e.to)];
			if (!from || !to || from.path !== to.path || e.at === undefined || e.at === to.line)
				return [];
			if (!near.has(e.from) && !near.has(e.to)) return [];
			return [{ path: from.path, from: e.at, to: to.line, broken: e.broken !== undefined }];
		});
	});
	/** those uses drawn: an arc in the margin from the use's row to its target's, an arrowhead there */
	let arcs = $state<{ d: string; head: string; broken: boolean }[]>([]);
	let margin = $state(0);
	/** where a file's line is drawn in the panel: a row of the whole file, or of a hunk showing it */
	function rowAt(pane: HTMLElement, path: string, line: number): HTMLElement | null {
		const whole = pane.querySelector<HTMLElement>(`[data-line="${line}"]`);
		if (whole) return whole;
		for (const [file] of shown?.byFile ?? []) {
			if (file.newPath !== path) continue;
			for (const hunk of file.hunks) {
				const index = hunk.lines.findIndex((l) => l.new === line);
				if (index < 0) continue;
				const base = `[data-hunk="${hunk.id}"][data-index="${index}"]`;
				return (
					pane.querySelector<HTMLElement>(`${base}[data-side="new"]`) ??
					pane.querySelector<HTMLElement>(base)
				);
			}
		}
		return null;
	}
	/** measured again whenever what's shown grows or changes, a hunk opened, the file read */
	const gutter: Attachment<HTMLElement> = (pane) => {
		const uses = within;
		let frame = 0;
		const draw = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const top = pane.getBoundingClientRect().top - pane.scrollTop;
				const middle = (row: HTMLElement) => {
					const r = row.getBoundingClientRect();
					return r.top - top + r.height / 2;
				};
				const placed = uses
					.map((u) => {
						const [a, b] = [rowAt(pane, u.path, u.from), rowAt(pane, u.path, u.to)];
						return a && b ? { ...u, ya: middle(a), yb: middle(b) } : null;
					})
					.filter((u) => u !== null)
					// the longer ones bow out further, round the shorter
					.sort((p, q) => Math.abs(p.ya - p.yb) - Math.abs(q.ya - q.yb));
				// as the map draws a use: out level, along a lane of its own in the margin, back in
				// level, rounded at the turns, the map's arrowhead at the end
				// the tip just short of the code; a level run long enough that the arrowhead sits on
				// a straight piece past the rounded corner, not on it
				const x = 34;
				const next = placed.map((u, i) => {
					const lane = x - Math.min(14 + i * 4, 30);
					return {
						d: rounded([
							[x, u.ya],
							[lane, u.ya],
							[lane, u.yb],
							[x, u.yb]
						]),
						head: `M${x},${u.yb} L${x - 6},${u.yb - 3.5} L${x - 6},${u.yb + 3.5} Z`,
						broken: u.broken
					};
				});
				// the same again changes nothing on the page, or drawing it would be seen as a change
				if (JSON.stringify(next) !== JSON.stringify(arcs)) arcs = next;
				if (margin !== pane.scrollHeight) margin = pane.scrollHeight;
			});
		};
		draw();
		const resized = new ResizeObserver(draw);
		resized.observe(pane);
		const changed = new MutationObserver(draw);
		changed.observe(pane, { childList: true, subtree: true });
		return () => {
			cancelAnimationFrame(frame);
			resized.disconnect();
			changed.disconnect();
			arcs = [];
		};
	};

	/**
	 * The canvas's dots: 20px apart at full size, and when zoomed out so far they'd crowd, twice
	 * as far apart and twice again; smaller the further out, from 1px down to half that
	 */
	const grid = $derived.by(() => {
		let size = 20 * st.view.k;
		while (size < 8) size *= 2;
		return size;
	});
	const dot = $derived(0.5 + 0.5 * Math.min(1, st.view.k));

	/** the panel's own layout, the page's until one's picked in it */
	let pick = $state<Layout | null>(null);
	const panelLayout = $derived(pick ?? lines);
	/**
	 * As wide as the Diff tab and the guide make a diff: for the change's longest line, from
	 * 80 columns up to 120, unified or side by side, a character as wide as the code's font
	 * draws it. An unchanged file is read in one column
	 */
	let char = $state(7.5);
	const PROBE = 100;
	const measureChar: Attachment<HTMLElement> = (probe) => {
		char = probe.getBoundingClientRect().width / PROBE || char;
	};
	const panelWidth = $derived(
		shown
			? // the margin for the in-file arrows, the padding and the border
				diffWidth(shown.byFile.length ? panelLayout : 'unified', columnsOf(files), char) + 54
			: 0
	);

	/** the line an unchanged declaration starts on, scrolled to near the top as its file opens */
	const scrollTo = (node: HTMLElement) => {
		// the panel's own scrolling only: scrollIntoView would move the canvas behind it too
		const pane = node.closest<HTMLElement>('[data-panel] .overflow-auto');
		if (pane) {
			pane.scrollTop += node.getBoundingClientRect().top - pane.getBoundingClientRect().top - 48;
		}
	};

	/** a legend key pointed at: what on the map it stands for, lit */
	let legendLit = $state<{ boxes: Set<string>; lines: Set<string> } | null>(null);
	/** a trunk pointed at: its uses lit as one */
	let bundle = $state<{ boxes: Set<string>; lines: Set<string> } | null>(null);
	/** the pointer's place on the map, as the layout measures it */
	function onMap(e: MouseEvent): [number, number] {
		const r = viewport!.getBoundingClientRect();
		return [
			(e.clientX - r.left - st.view.x) / st.view.k - PAD - st.origin.x,
			(e.clientY - r.top - st.view.y) / st.view.k - PAD - st.origin.y
		];
	}
	function say(e: MouseEvent, text: string) {
		const [x, y] = onMap(e);
		tip = { x: x + 6, y, text };
	}
	/** uses added up by kind: calls ×2 · renders */
	function kinds(list: Line[]) {
		const counts = new Map<UseKind, number>();
		for (const l of list) counts.set(l.use, (counts.get(l.use) ?? 0) + l.count);
		return [...counts].map(([use, n]) => `${USES[use]}${n > 1 ? ` ×${n}` : ''}`).join(' · ');
	}
	const names = (ids: string[]) => {
		const named = [...new Set(ids)].map((id) => drawn?.boxes.find((b) => b.id === id)?.name ?? id);
		return named.slice(0, 4).join(', ') + (named.length > 4 ? ` +${named.length - 4}` : '');
	};
	/** a line pointed at: drawn on top, the rest of its source's faded a little, its code shown */
	function pointAt(e: MouseEvent, l: Line) {
		line = l;
		say(e, l.sample || USES[l.use]);
	}
	/** a trunk pointed at: all its uses lit, and where they go, or where they come from */
	function pointTrunk(e: MouseEvent, t: { box: string; arrives: boolean; lines: string[] }) {
		const list = t.lines.map((k) => lineByKey.get(k)).filter((l) => l !== undefined);
		const others = list.map((l) => (t.arrives ? l.fromBox : l.toBox));
		bundle = { boxes: new Set([t.box, ...others]), lines: new Set(t.lines) };
		say(e, `${kinds(list)} ${t.arrives ? '←' : '→'} ${names(others)}`);
	}
	/** an arrowhead pointed at: how many arrive there, from where */
	function pointHead(e: MouseEvent, h: { lines: string[] }) {
		const list = h.lines.map((k) => lineByKey.get(k)).filter((l) => l !== undefined);
		const n = list.reduce((sum, l) => sum + l.count, 0);
		say(e, `${n} ${n === 1 ? 'use' : 'uses'} from ${names(list.map((l) => l.fromBox))}`);
	}
	/** a label pointed at: the code of each use it stands for, beside it */
	function pointLabel(label: SVGTextElement, list: Line[], left: boolean) {
		const box = label.getBBox();
		tip = {
			x: left ? box.x : box.x + box.width,
			y: box.y + box.height / 2,
			text: list
				.map((l) => l.sample || USES[l.use])
				.slice(0, 4)
				.join('\n'),
			left
		};
	}
	function pointAway() {
		line = null;
		bundle = null;
		tip = null;
	}
	const W = NODE_W + GAP_X;

	/** the box something is in, as the map's drawn now: itself, or the box it's a row of */
	const boxOf = (id: string) =>
		drawn?.boxes.find((b) => b.id === id || b.rows.some((r) => r.id === id));
	/**
	 * What's lit, the rest faded: boxes, and for a member row only its own uses and the rows
	 * at their other ends, not its box's other rows'
	 */
	type Focus = { boxes: Set<string>; lines?: Set<string>; rows?: Set<string> };
	const key = (l: { from: string; to: string }) => `${l.from}>${l.to}`;
	/**
	 * A box with everything above and below it in the tree; a member row with what it uses
	 * and what uses it, inside its box too
	 */
	const focusOf = (target: string | null): Focus | null => {
		if (!drawn || !target) return null;
		const box = boxOf(target)?.id ?? target;
		const between = drawn.lines.filter((l) => l.fromBox !== l.toBox);
		if (box !== target) {
			const own = drawn.lines.filter((l) => l.from === target || l.to === target);
			return {
				boxes: new Set([box, ...own.flatMap((l) => [l.fromBox, l.toBox])]),
				lines: new Set(own.map(key)),
				rows: new Set([target, ...own.flatMap((l) => [l.from, l.to])])
			};
		}
		const ups = Map.groupBy(between, (l) => l.toBox);
		const downs = Map.groupBy(between, (l) => l.fromBox);
		const walk = (id: string, next: typeof ups, end: 'fromBox' | 'toBox', seen: Set<string>) => {
			for (const l of next.get(id) ?? []) {
				if (seen.has(l[end])) continue;
				seen.add(l[end]);
				walk(l[end], next, end, seen);
			}
			return seen;
		};
		return {
			boxes: new Set([
				...walk(box, ups, 'fromBox', new Set([box])),
				...walk(box, downs, 'toBox', new Set([box]))
			])
		};
	};
	/**
	 * What's selected stays lit, the pointer doesn't move it; with nothing selected, what the
	 * pointer's on lights up the same way
	 */
	const branch = $derived(st.selected ? focusOf(st.selected) : focusOf(hovered));
	/**
	 * With something selected, a preview on top of it of what the pointer's on: its own uses,
	 * stronger inside the selection, half lit outside it, the box itself lifted from the fade
	 */
	const preview = $derived.by(() => {
		if (!st.selected || !hovered || !drawn || hovered === st.selected) return null;
		const box = boxOf(hovered)?.id ?? hovered;
		const own = drawn.lines.filter(
			(l) =>
				l.from === hovered ||
				l.to === hovered ||
				(box === hovered && (l.fromBox === box || l.toBox === box))
		);
		return { box, row: box === hovered ? null : hovered, lines: new Set(own.map(key)) };
	});

	/** where to look first: each box's heat and why, and the uses from callers left behind */
	const hot = $derived(drawn ? heatOf(drawn.boxes, drawn.lines) : null);
	/** the theme's red pulled a little towards its text, to stand out on every box, see heat.test.ts */
	const HEAT = 'color-mix(in srgb, var(--del) 70%, var(--fg))';
	/** callers whose use no longer type-checks */
	const broken = $derived(new Set(drawn?.lines.filter((l) => l.broken).map((l) => l.fromBox)));
	const warm = (l: { from: string; to: string }) => hot?.warm.has(`${l.from}>${l.to}`) ?? false;
	/** the box whose reasons are shown, clicked open or pointed at */
	let card = $state<string | null>(null);
	let peek = $state<string | null>(null);
	/** what a reason is about, lit while it's pointed at, or since it was clicked */
	let litHover = $state<Set<string> | null>(null);
	let pinned = $state<{ key: string; ids: Set<string> } | null>(null);
	/** what's lit: a reason's boxes, else the branch the pointer's on; the rest fades */
	const focus = $derived<Focus | null>(
		litHover
			? { boxes: litHover }
			: (legendLit ?? bundle ?? (pinned ? { boxes: pinned.ids } : branch))
	);
	const lineByKey = $derived(new Map(drawn?.lines.map((l) => [key(l), l])));
	/**
	 * The labels shown, one where uses arrive, for those of them that are hovered, selected or
	 * pointed at, their kinds added up; pushed apart where they'd overlap
	 */
	const labels = $derived.by(() => {
		if (!drawn) return [];
		const shown = (l: Line) =>
			l === line ||
			(hovered !== null && related(l, hovered)) ||
			(st.selected !== null && related(l, st.selected));
		const out = drawn.heads.flatMap((h) => {
			const list = h.lines
				.map((k) => lineByKey.get(k))
				.filter((l): l is Line => l !== undefined && shown(l));
			if (!list.length) return [];
			const end = h.dir > 0;
			return [
				{
					key: `${h.x},${h.y},${h.dir}`,
					x: h.x - h.dir * 11,
					y: h.y - 5,
					end,
					text: kinds(list),
					list
				}
			];
		});
		for (const group of Map.groupBy(out, (l) => `${l.x}|${l.end}`).values()) {
			group.sort((a, b) => a.y - b.y);
			for (let i = 1; i < group.length; i++) group[i].y = Math.max(group[i].y, group[i - 1].y + 13);
		}
		return out;
	});
	const inBranch = (l: Line) =>
		!focus ||
		(focus.lines
			? focus.lines.has(key(l))
			: focus.boxes.has(l.fromBox) && focus.boxes.has(l.toBox));

	/** a box that opens into its members: ▸ or a double click opens it, a click selects it */
	const opens = (n: MapNode & { members?: true }) => (n.members || madeUp(n)) && n.kind !== 'more';
	function select(id: string) {
		st.selected = st.selected === id ? null : id;
	}

	function openCard(id: string | null) {
		card = id;
		pinned = null;
	}

	/** centres a box in the window, its reasons open */
	function goTo(id: string) {
		const b = drawn?.boxes.find((x) => x.id === id);
		if (!b || !viewport) return;
		const k = st.view.k;
		st.view = {
			k,
			x: viewport.clientWidth / 2 - (b.x + PAD + st.origin.x + NODE_W / 2) * k,
			y: viewport.clientHeight / 2 - (b.y + PAD + st.origin.y + b.h / 2) * k
		};
		openCard(id);
	}

	/**
	 * Makes a change that lays the map out again, the box `id` is in staying where it is:
	 * everything else slides to its new place around it
	 */
	function keeping(id: string, change: () => void) {
		const was = boxOf(id);
		change();
		const now = was && drawn?.boxes.find((b) => b.id === was.id);
		if (was && now) {
			st.origin = { x: st.origin.x + was.x - now.x, y: st.origin.y + was.y - now.y };
		}
	}

	// the map is a canvas: panned by scrolling or dragging, zoomed by pinching or ⌘/ctrl
	// scrolling, about the pointer
	const MIN_ZOOM = 0.15;
	const MAX_ZOOM = 2.5;
	let dragging = $state(false);
	let viewport = $state<HTMLElement>();
	/** the map's size, unzoomed, and whether it's been st.fitted to the window yet */
	let size = { w: 0, h: 0 };

	function zoomAt(k: number, px: number, py: number) {
		const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
		st.view = {
			k: next,
			x: px - ((px - st.view.x) * next) / st.view.k,
			y: py - ((py - st.view.y) * next) / st.view.k
		};
	}

	function zoomBy(factor: number) {
		if (!viewport) return;
		zoomAt(st.view.k * factor, viewport.clientWidth / 2, viewport.clientHeight / 2);
	}

	/** the whole map in the window, never bigger than it is */
	function fit(node = viewport) {
		if (!node || !size.w) return;
		const k = Math.max(
			MIN_ZOOM,
			Math.min(1, node.clientWidth / size.w, node.clientHeight / size.h)
		);
		// the map is drawn from its origin, taken back off here
		st.view = {
			k,
			x: (node.clientWidth - size.w * k) / 2 - st.origin.x * k,
			y: Math.max(0, (node.clientHeight - size.h * k) / 2) - st.origin.y * k
		};
	}

	function canvas(w: number, h: number): Attachment<HTMLElement> {
		return (node) => {
			viewport = node;
			size = { w, h };
			// down to the bottom of the window from where it starts
			node.style.height = `calc(100dvh - ${node.getBoundingClientRect().top + scrollY}px)`;
			if (!st.fitted) {
				st.fitted = true;
				fit(node);
			}
			const wheel = (e: WheelEvent) => {
				// the code beside the map scrolls as itself
				if ((e.target as Element).closest('[data-panel]')) return;
				e.preventDefault();
				const r = node.getBoundingClientRect();
				// a trackpad's pinch comes as a wheel with ctrl held
				if (e.ctrlKey || e.metaKey) {
					zoomAt(st.view.k * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
				} else st.view = { ...st.view, x: st.view.x - e.deltaX, y: st.view.y - e.deltaY };
			};
			let from: { x: number; y: number; px: number; py: number } | null = null;
			const down = (e: PointerEvent) => {
				// on the map itself, a box's buttons and a file's name are for clicking
				if (e.button !== 0 || (e.target as Element).closest('button, [role=dialog], [data-panel]'))
					return;
				from = { x: st.view.x, y: st.view.y, px: e.clientX, py: e.clientY };
				onEmpty = !(e.target as Element).closest('[role=group]');
				dragging = true;
				node.setPointerCapture(e.pointerId);
			};
			const move = (e: PointerEvent) => {
				if (from)
					st.view = {
						...st.view,
						x: from.x + e.clientX - from.px,
						y: from.y + e.clientY - from.py
					};
			};
			let onEmpty = false;
			const up = (e: PointerEvent) => {
				// a click on the canvas itself, not a drag, lets go of what's selected
				if (from && onEmpty && Math.hypot(e.clientX - from.px, e.clientY - from.py) < 4) {
					st.selected = null;
					openCard(null);
				}
				from = null;
				dragging = false;
			};
			node.addEventListener('wheel', wheel, { passive: false });
			node.addEventListener('pointerdown', down);
			node.addEventListener('pointermove', move);
			node.addEventListener('pointerup', up);
			node.addEventListener('pointercancel', up);
			return () => {
				node.removeEventListener('wheel', wheel);
				node.removeEventListener('pointerdown', down);
				node.removeEventListener('pointermove', move);
				node.removeEventListener('pointerup', up);
				node.removeEventListener('pointercancel', up);
			};
		};
	}

	// one job for each channel: the border and tint say what the change did to a box, only on
	// what it changed; the name and the line under it, how; a red bar, what needs attention;
	// a line's weight, a new use, and red, a use that no longer type-checks
	const STATUS = {
		added: 'border-add bg-add/12',
		modified: 'border-mod bg-mod/12',
		removed: 'border-line bg-subtle/40 line-through opacity-70',
		affected: 'border-line/80'
	};
	const DOT = {
		added: 'bg-add',
		modified: 'bg-mod',
		removed: 'bg-faint',
		affected: 'border border-faint'
	};
	const USES: Record<UseKind, string> = {
		call: 'calls',
		render: 'renders',
		prop: 'passes',
		type: 'as a type',
		write: 'writes',
		read: 'reads',
		import: 'imports'
	};

	/** boxes made of others: folded files open without asking, counted ones don't at all */
	const madeUp = (n: MapNode) => n.kind === 'file' || n.kind === 'tests' || n.kind === 'more';
	/** what ‹, › and ▸ do, said when the pointer's on them */
	const imports = (n: MapNode) => ['component', 'file', 'tests'].includes(n.kind);
	function says(n: MapNode, way: Way): [string, string] {
		if (way === 'users') {
			return loading(n, way)
				? ['Finding what uses it…', `Asking the language server for every use of ${n.name}`]
				: ['What uses this', `Adds what calls, renders or refers to ${n.name}, on the left`];
		}
		if (way === 'uses') {
			const what = imports(n) ? `what ${n.name} imports` : `the functions ${n.name} calls`;
			return loading(n, way)
				? ['Finding what it uses…', `Asking the language server for ${what}`]
				: ['What this uses', `Adds ${what}, on the right`];
		}
		return st.open.has(n.id)
			? ['Close', `Back to one box for ${n.name}`]
			: loading(n, way)
				? ['Opening…', `Finding what's in ${n.name}`]
				: [
						"What's inside",
						`Opens ${n.name} into its members, the changed ones and those linked to the map`
					];
	}
	const loading = (n: MapNode, way: Way) => st.asking.has(`${n.id}:${way}`);
	const canAsk = (n: MapNode, way: Way) =>
		n.status !== 'removed' &&
		n.kind !== 'more' &&
		(way === 'uses' || !madeUp(n)) &&
		!st.asked.has(`${n.id}:${way}`);

	async function expand(node: MapNode, way: Way) {
		const key = `${node.id}:${way}`;
		if (st.asked.has(key) || st.asking.has(key)) return;
		st.asking.add(key);
		st.failure = '';
		try {
			const part = await expandChangeMap({
				repo,
				start,
				stop,
				way,
				node: { id: node.id, path: node.path, line: node.line, char: node.char, kind: node.kind }
			});
			const before = new Set(map?.nodes.map((n) => n.id));
			keeping(node.id, () => {
				st.more = [...st.more, part];
				if (way === 'members') st.open.add(node.id);
			});
			if (way !== 'members') tell(node, way, part, before);
			st.asked.add(key);
		} catch (error) {
			const e = error as { body?: { message?: string }; message?: string };
			st.failure = e.body?.message ?? e.message ?? String(error);
		} finally {
			st.asking.delete(key);
		}
	}

	/** what ‹ or › found, said in the strip, its boxes outlined for a moment */
	function tell(node: MapNode, way: Way, part: ChangeMap, before: Set<string>) {
		const ends = new Set(part.edges.map((e) => (way === 'users' ? e.from : e.to)));
		const there = [...ends].filter((id) => before.has(id)).length;
		const what = way === 'users' ? `What uses ${node.name}` : `What ${node.name} uses`;
		found = !ends.size
			? `${what}: nothing found`
			: `${what}: ${ends.size} found, ${there ? `${there} of them already on the map, outlined` : 'all new, outlined'}`;
		// a box shows what's found in it, a member in its component or class, a declaration in its file
		const marked = new Set<string>();
		for (const id of ends) {
			const n = map?.nodes.find((m) => m.id === id);
			marked.add(id);
			if (n?.parent) marked.add(n.parent);
			if (n) marked.add(`${n.path}:file`);
		}
		flash = marked;
		setTimeout(() => {
			if (flash === marked) flash = new Set();
		}, 2500);
	}

	function toggle(node: MapNode) {
		if (st.open.has(node.id)) keeping(node.id, () => st.open.delete(node.id));
		// its members already on the map, from the first look or asked before
		else if (
			madeUp(node) ||
			st.asked.has(`${node.id}:members`) ||
			map?.nodes.some((n) => n.parent === node.id)
		) {
			keeping(node.id, () => st.open.add(node.id));
		} else expand(node, 'members');
	}

	/** under a box's name: how the change touched it, or for one it didn't, what and where */
	function sub(n: MapNode & { folded: number }): string {
		const file = n.path.split('/').pop();
		const where =
			n.kind === 'tests'
				? `tests · ${n.path}`
				: n.folded
					? `${n.folded} declarations · ${n.path}`
					: n.kind === 'component'
						? n.path
						: `${n.kind} · ${file}`;
		if (n.kind === 'more') return `in ${n.path}`;
		if (n.status === 'affected') return where;
		if (n.status === 'removed') return `removed · ${where}`;
		const how =
			n.status === 'added'
				? `new · ${n.plus ?? 0} ${n.plus === 1 ? 'line' : 'lines'}`
				: `${n.signature ? 'signature' : 'body'} · +${n.plus ?? 0} −${n.minus ?? 0}`;
		return `${how} · ${n.kind === 'component' || n.folded || n.kind === 'tests' ? n.path : file}`;
	}

	/**
	 * A line's colour: red for a use that no longer type-checks, and for one left behind by a
	 * changed outside while it's in focus; the text's for a new use; faint for one that was there
	 */
	const tone = (l: Line) =>
		l.broken || (warm(l) && focus !== null && inBranch(l)) ? 'heat' : l.added ? 'new' : 'old';
	const STROKE = { heat: 'stroke-(--heat)', new: 'stroke-fg', old: 'stroke-faint' };
	const FILL = { heat: 'fill-(--heat)', new: 'fill-fg', old: 'fill-faint' };
	const weight = (l: Line) => Math.min(1 + Math.log2(l.count), 3) + (l.added ? 0.5 : 0);

	/** the legend's keys, each lighting what it stands for on the map */
	function lightUp(kind: 'added' | 'modified' | 'affected' | 'attention' | 'new' | 'broken') {
		if (!drawn) return;
		if (kind === 'new' || kind === 'broken') {
			const list = drawn.lines.filter((l) => (kind === 'new' ? l.added : l.broken));
			legendLit = {
				boxes: new Set(list.flatMap((l) => [l.fromBox, l.toBox])),
				lines: new Set(list.map(key))
			};
		} else {
			const boxes = drawn.boxes.filter((b) =>
				kind === 'attention' ? hot?.heat.get(b.id)?.level === 2 : b.status === kind
			);
			legendLit = { boxes: new Set(boxes.map((b) => b.id)), lines: new Set() };
		}
	}

	/** a group's name: how much it holds and how much of it needs a look */
	function groupLabel(g: { ids: string[]; lone: boolean; label: string }) {
		if (g.lone) return g.label;
		const boxes = g.ids
			.map((id) => drawn?.boxes.find((b) => b.id === id))
			.filter((b) => b !== undefined);
		const files = new Set(boxes.map((b) => b.path)).size;
		const changed = boxes.filter((b) => b.status !== 'affected').length;
		const attention = boxes.filter((b) => hot?.heat.get(b.id)?.level === 2).length;
		return [
			`${files} ${files === 1 ? 'file' : 'files'}`,
			`${changed} changed`,
			attention && `${attention} ${attention === 1 ? 'needs' : 'need'} attention`
		]
			.filter(Boolean)
			.join(' · ');
	}
	/** the list of what to look at first, open under the toolbar */
	let firstOpen = $state(false);

	const related = (l: Line, id: string) =>
		l.from === id || l.to === id || l.fromBox === id || l.toBox === id;

	const summary = (map: ChangeMap) => {
		const changed = map.nodes.filter((n) => n.status !== 'affected' && !n.parent).length;
		const fresh = map.edges.filter((e) => e.added).length;
		return `${changed} changed · ${fresh} new ${fresh === 1 ? 'use' : 'uses'}`;
	};
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key !== 'Escape' || typing(e) || (!st.selected && !card)) return;
		st.selected = null;
		openCard(null);
	}}
/>

{#snippet spinner(size: string)}
	<span
		class={['animate-spin rounded-full border-[1.5px] border-ink-soft/40 border-t-ink', size]}
		aria-hidden="true"
	></span>
{/snippet}

<!-- a label for a button, shown at once while the pointer or focus is on it -->
{#snippet hint(node: MapNode, way: Way, place: 'left' | 'right')}
	{@const [title, detail] = says(node, way)}
	{@render label(title, detail, place)}
{/snippet}

{#snippet label(title: string, detail: string, place: 'left' | 'right')}
	<span
		role="tooltip"
		class={[
			'pointer-events-none absolute top-1/2 z-30 w-max max-w-60 -translate-y-1/2 rounded-md border border-line bg-surface px-2 py-1 text-left font-sans text-[11px] leading-snug opacity-0 shadow-raised transition-opacity delay-100 group-hover/hint:opacity-100 group-focus-visible/hint:opacity-100',
			place === 'left' ? 'right-full mr-2' : 'left-full ml-2'
		]}
	>
		<span class="block font-medium text-fg">{title}</span>
		<span class="block text-muted">{detail}</span>
	</span>
{/snippet}

<!-- to the diff: the Diff tab at the first change in it, leaving the map as it is -->
{#snippet toDiff(node: MapNode, size: string)}
	{#if node.hunks.length}
		<button
			type="button"
			class={[
				'group/hint relative grid shrink-0 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg',
				size
			]}
			aria-label="Show {node.name} in the diff"
			onclick={() => onjump(node.hunks[0])}
		>
			<!-- arrows out to the corners, as for a file opened up in the full diff -->
			<svg
				viewBox="0 0 16 16"
				class="size-3"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" /></svg
			>
			{@render label(
				'Show in the diff',
				`Opens the Diff tab at ${node.hunks.length === 1 ? 'its change' : `the first of its ${node.hunks.length} changes`}; the map stays as it is`,
				'right'
			)}
		</button>
	{/if}
{/snippet}

<!-- why a box needs a look: its reasons, the worst first, each lighting up what it's about -->
{#snippet why(box: MapNode & { users: number }, heat: Heat)}
	{@const id = box.id}
	<span
		role="dialog"
		aria-label="Why"
		class="absolute top-full left-0 z-40 mt-1.5 block w-72 rounded-lg border border-line bg-surface p-1.5 text-left font-sans shadow-raised"
	>
		<span class="block px-1.5 pb-1 text-[10.5px] font-medium tracking-wide text-faint uppercase">
			{heat.level === 2 ? 'Needs attention' : 'Worth a look'}
		</span>
		{#each heat.reasons as reason, i (i)}
			{@const key = `${id}:${i}`}
			{@const ids = new Set([id, ...reason.ids])}
			<button
				type="button"
				class={[
					'flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-[11.5px] hover:bg-subtle',
					pinned?.key === key && 'bg-subtle'
				]}
				aria-pressed={pinned?.key === key}
				onmouseenter={() => (litHover = ids)}
				onmouseleave={() => (litHover = null)}
				onfocus={() => (litHover = ids)}
				onblur={() => (litHover = null)}
				onclick={() => (pinned = pinned?.key === key ? null : { key, ids })}
			>
				<i
					class={[
						'mt-1 size-2 shrink-0 rounded-full',
						reason.level === 2 ? 'bg-(--heat)' : 'border border-(--heat)'
					]}
				></i>
				<span class="text-fg">{reason.text}</span>
			</button>
		{/each}
		{#if box.users > 1}
			<span class="block border-t border-line/60 px-1.5 pt-1 text-[10.5px] text-muted">
				Used by {box.users}
			</span>
		{/if}
	</span>
{/snippet}

<!-- ‹ and › at a box's sides, shown on hover, and while it's being asked, a spinner in its place -->
{#snippet asks(node: MapNode)}
	{#each [['users', '‹', `Show what uses ${node.name}`, '-left-2.5', 'left'], ['uses', '›', `Show what ${node.name} uses`, '-right-2.5', 'right']] as const as [way, glyph, label, side, place] (way)}
		{#if canAsk(node, way)}
			<button
				type="button"
				class={[
					'group/hint absolute top-1/2 z-10 size-5 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-control text-[11px] text-muted shadow-raised hover:text-fg',
					side,
					loading(node, way) ? 'flex' : 'hidden group-focus-within:flex group-hover:flex'
				]}
				aria-label={label}
				aria-busy={loading(node, way)}
				onclick={() => expand(node, way)}
			>
				{#if loading(node, way)}{@render spinner('size-3')}{:else}{glyph}{/if}
				{@render hint(node, way, place)}
			</button>
		{/if}
	{/each}
{/snippet}

{#if query.error}
	<div class="px-4 py-24 text-center">
		<p class="text-[13px] font-medium">Couldn't map the change</p>
		<p class="mt-1 font-mono text-[12px] text-muted">
			{query.error?.body?.message ?? query.error?.message ?? String(query.error)}
		</p>
	</div>
{:else if !map || !drawn}
	<div class="flex flex-col items-center px-4 py-24 text-center">
		<span class="size-4 animate-spin rounded-full border-2 border-ink-soft/40 border-t-ink"></span>
		<p class="mt-3 text-[13px] font-medium">Reading the change with the language servers</p>
		<p class="mt-1 max-w-sm text-[12px] text-muted">
			Finding what it changes and what uses it, at the head commit. A first run indexes the repo.
		</p>
	</div>
{:else}
	<!-- the file of what the pointer is on, its boxes elsewhere outlined -->
	{@const pointed = hovered ? boxOf(hovered)?.path : undefined}
	<div
		class="relative z-40 flex items-center gap-4 border-b border-line px-4 py-2 text-[11.5px] text-muted"
	>
		<span>{summary(map)}</span>
		{#if found}
			<span class="text-fg">{found}</span>
		{:else}
			<span class="text-faint"
				>click to focus · ▸ or double-click opens · ‹ what uses it · › what it uses · ⤢ in the diff
				· esc clears</span
			>
		{/if}
		<!-- what each mark means, pointed at, what on the map it stands for lights up -->
		<span class="ml-auto flex items-center gap-1" style:--heat={HEAT}>
			{#each [['added', 'added', 'size-2.5 rounded-sm border border-add bg-add/12'], ['modified', 'modified', 'size-2.5 rounded-sm border border-mod bg-mod/12'], ['affected', 'unchanged', 'size-2.5 rounded-sm border border-line'], ['attention', 'needs attention', 'h-3 w-1 rounded-full bg-(--heat)'], ['new', 'new use', 'h-[1.5px] w-4 bg-fg'], ['broken', 'broken call', 'h-[1.5px] w-4 bg-(--heat)']] as const as [kind, name, mark] (kind)}
				<button
					type="button"
					class="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-subtle hover:text-fg"
					onmouseenter={() => lightUp(kind)}
					onmouseleave={() => (legendLit = null)}
					onfocus={() => lightUp(kind)}
					onblur={() => (legendLit = null)}><i class={mark}></i>{name}</button
				>
			{/each}
		</span>
		{#if hot?.heat.size}
			<span class="relative">
				<button
					type="button"
					class={[
						'flex items-center gap-1.5 rounded-md border border-line bg-control px-2 py-0.5 hover:text-fg',
						firstOpen && 'text-fg'
					]}
					style:--heat={HEAT}
					aria-expanded={firstOpen}
					onclick={() => (firstOpen = !firstOpen)}
					><i class="h-3 w-1 rounded-full bg-(--heat)"></i>Look here first</button
				>
				{#if firstOpen}
					<!-- the boxes to look at first, a click away -->
					<div
						class="absolute top-full right-0 z-50 mt-1.5 w-72 rounded-lg border border-line bg-surface p-1.5 shadow-raised"
						style:--heat={HEAT}
					>
						{#each ranked(hot.heat) as id (id)}
							{@const b = drawn.boxes.find((x) => x.id === id)}
							{@const h = hot.heat.get(id)!}
							{#if b}
								<button
									type="button"
									class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-subtle"
									onclick={() => {
										firstOpen = false;
										goTo(id);
									}}
								>
									<i
										class={[
											'h-6 w-1 shrink-0 rounded-full',
											h.level === 2 ? 'bg-(--heat)' : 'border border-(--heat)'
										]}
									></i>
									<span class="min-w-0 flex-1">
										<span class="block truncate font-mono text-[11.5px] text-fg">{b.name}</span>
										<span class="block truncate text-[10.5px] text-muted">{h.reasons[0].text}</span>
									</span>
								</button>
							{/if}
						{/each}
					</div>
				{/if}
			</span>
		{/if}
		<span class="flex items-center overflow-hidden rounded-md border border-line bg-control">
			<button
				type="button"
				class="px-2 py-0.5 hover:text-fg"
				title="Zoom out"
				aria-label="Zoom out"
				onclick={() => zoomBy(1 / 1.25)}>−</button
			>
			<button
				type="button"
				class="w-12 border-x border-line py-0.5 tabular-nums hover:text-fg"
				title="Actual size"
				onclick={() => zoomBy(1 / st.view.k)}>{Math.round(st.view.k * 100)}%</button
			>
			<button
				type="button"
				class="px-2 py-0.5 hover:text-fg"
				title="Zoom in"
				aria-label="Zoom in"
				onclick={() => zoomBy(1.25)}>+</button
			>
			<button
				type="button"
				class="border-l border-line px-2 py-0.5 hover:text-fg"
				title="Fit the map in the window"
				onclick={() => fit()}>Fit</button
			>
		</span>
	</div>
	{#each map.notes as note (note)}
		<p class="border-b border-line px-4 py-1.5 text-[11.5px] text-muted">{note}</p>
	{/each}
	{#if st.failure}
		<p class="border-b border-line px-4 py-1.5 font-mono text-[11.5px] text-del">{st.failure}</p>
	{/if}
	{#if drawn.boxes.length === 0}
		<div class="px-4 py-24 text-center text-[12px] text-muted">
			Nothing here a language server reads: TypeScript, JavaScript, Svelte, or C and C++ with a
			compile_commands.json.
		</div>
	{:else}
		<div
			{@attach canvas(drawn.width + PAD * 2, drawn.height + PAD * 2)}
			class={[
				'relative touch-none overflow-hidden select-none',
				dragging ? 'cursor-grabbing' : 'cursor-grab'
			]}
			style:--heat={HEAT}
			style:background-image="radial-gradient(var(--line) {dot}px, transparent {dot}px)"
			style:background-size="{grid}px {grid}px"
			style:background-position="{st.view.x}px {st.view.y}px"
		>
			<div
				class="absolute top-0 left-0 origin-top-left"
				style:transform="translate({st.view.x}px, {st.view.y}px) scale({st.view.k})"
			>
				<!-- every other column faintly shaded, a column a depth -->
				{#each Array.from({ length: drawn.columns }, (_, c) => c).filter((c) => c % 2) as c (c)}
					<div
						class="pointer-events-none absolute top-0 left-0 bg-subtle/30"
						style:width="{W}px"
						style:height="{drawn.height + PAD * 2}px"
						style:transform="translate({c * W - GAP_X / 2 + PAD + st.origin.x}px, {st.origin.y}px)"
					></div>
				{/each}
				{#each drawn.groups as group (group.x + ',' + group.y)}
					<div
						class={[
							'pointer-events-none absolute top-0 left-0 rounded-2xl border',
							group.lone ? 'border-dashed border-line' : 'border-line bg-subtle/25',
							'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.77,0,0.175,1)]'
						]}
						style:transform="translate({group.x + PAD + st.origin.x}px, {group.y +
							PAD +
							st.origin.y}px)"
						style:width="{group.w}px"
						style:height="{group.h}px"
					>
						<span
							class="absolute top-2 left-3.5 max-w-[calc(100%-1.5rem)] truncate text-[11px] font-medium text-muted"
							>{groupLabel(group)}</span
						>
					</div>
				{/each}
				<svg
					class="pointer-events-none absolute inset-0 overflow-visible"
					width={drawn.width + PAD * 2}
					height={drawn.height + PAD * 2}
					aria-hidden="true"
				>
					<!-- laid out again, the lines fade in as the boxes arrive -->
					{#key drawn}
						<g class="arrive" transform="translate({PAD + st.origin.x},{PAD + st.origin.y})">
							{#each drawn.lines as l (l.from + '>' + l.to)}
								<path
									d={l.d}
									fill="none"
									class={[
										'pointer-events-none transition-opacity',
										STROKE[tone(l)],
										!inBranch(l)
											? preview?.lines.has(key(l))
												? 'opacity-50'
												: 'opacity-15'
											: line && line !== l && line.fromBox === l.fromBox && 'opacity-60'
									]}
									stroke-width={weight(l) + (preview?.lines.has(key(l)) && inBranch(l) ? 1 : 0)}
								/>
								<!-- a wider, invisible stroke to point at -->
								<path
									role="presentation"
									d={l.d}
									fill="none"
									stroke="transparent"
									stroke-width="7"
									pointer-events="stroke"
									onmouseenter={(e) => pointAt(e, l)}
									onmousemove={(e) => pointAt(e, l)}
									onmouseleave={pointAway}
								/>
							{/each}
							<!-- the line pointed at, on top of the others it runs with -->
							{#if line}
								<path
									d={line.d}
									fill="none"
									class={[
										'pointer-events-none',
										tone(line) === 'old' ? 'stroke-muted' : STROKE[tone(line)]
									]}
									stroke-width={weight(line) + 0.5}
								/>
							{/if}
							<!-- where a box's uses leave together: pointed at, they're lit as one -->
							{#each drawn.trunks as t (t.d)}
								<path
									role="presentation"
									d={t.d}
									fill="none"
									stroke="transparent"
									stroke-width="7"
									pointer-events="stroke"
									onmouseenter={(e) => pointTrunk(e, t)}
									onmousemove={(e) => pointTrunk(e, t)}
									onmouseleave={pointAway}
								/>
							{/each}
							<!-- where a source's lines part; no dot, they only cross -->
							{#each drawn.dots as dot (`${dot.x},${dot.y}`)}
								<circle
									cx={dot.x}
									cy={dot.y}
									r="3"
									class={[
										'pointer-events-none fill-muted transition-opacity',
										focus &&
											!dot.lines.some((k) => {
												const l = lineByKey.get(k);
												return l !== undefined && inBranch(l);
											}) &&
											'opacity-15'
									]}
								/>
							{/each}
							<!-- one arrowhead where uses arrive, pointing straight in along their last run -->
							{#each drawn.heads as h (`${h.x},${h.y},${h.dir}`)}
								<path
									d="M{h.x},{h.y} L{h.x - h.dir * 8},{h.y - 4} L{h.x - h.dir * 8},{h.y + 4} Z"
									class={[
										'pointer-events-none transition-opacity',
										FILL[
											h.lines
												.map((k) => lineByKey.get(k))
												.some((l) => l !== undefined && tone(l) === 'heat')
												? 'heat'
												: h.added
													? 'new'
													: 'old'
										],
										focus &&
											!drawn.lines.some(
												(l) =>
													h.lines.includes(`${l.from}>${l.to}`) &&
													(inBranch(l) || preview?.lines.has(key(l)))
											) &&
											'opacity-15'
									]}
								/>
								<circle
									role="presentation"
									cx={h.x - h.dir * 4}
									cy={h.y}
									r="7"
									fill="transparent"
									pointer-events="all"
									onmouseenter={(e) => pointHead(e, h)}
									onmouseleave={pointAway}
								/>
							{/each}
							<!-- what uses are, where they arrive: for those hovered, selected or pointed at, their
							kinds added up; pointed at, the code of each beside it -->
							{#each labels as label (label.key)}
								<text
									role="presentation"
									x={label.x}
									y={label.y}
									text-anchor={label.end ? 'end' : 'start'}
									class="pointer-events-auto cursor-default fill-muted text-[10.5px]"
									paint-order="stroke"
									stroke="var(--canvas)"
									stroke-width="4"
									onmouseenter={(e) => pointLabel(e.currentTarget, label.list, label.end)}
									onmouseleave={pointAway}>{label.text}</text
								>
							{/each}
						</g>
					{/key}
				</svg>
				{#each drawn.boxes as box (box.id)}
					<div
						class={[
							'group absolute top-0 left-0 rounded-lg border',
							'transition-opacity motion-safe:transition-[transform,opacity] motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.77,0,0.175,1)]',
							STATUS[box.status],
							focus && !focus.boxes.has(box.id) && preview?.box !== box.id && 'opacity-30',
							// above the others while it shows a label or its reasons
							(hovered === box.id || card === box.id || peek === box.id) && 'z-30',
							broken.has(box.id)
								? 'ring-2 ring-(--heat)'
								: flash.has(box.id)
									? 'ring-2 ring-accent'
									: st.selected === box.id
										? 'ring-2 ring-fg/40'
										: pointed === box.path && hovered !== box.id && 'ring-1 ring-muted'
						]}
						style:transform="translate({box.x + PAD + st.origin.x}px, {box.y +
							PAD +
							st.origin.y}px)"
						style:width="{NODE_W}px"
						style:height="{box.h}px"
						role="group"
						onmouseenter={() => (hovered = box.id)}
						onmouseleave={() => (hovered = null)}
					>
						<div class="flex items-center" style:height="{box.open ? HEAD_H : NODE_H}px">
							<button
								type="button"
								class="flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-center pl-2.5 text-left"
								title="{box.path}{box.line ? `:${box.line}` : ''}"
								aria-pressed={st.selected === box.id}
								onclick={() => select(box.id)}
								ondblclick={() => {
									// its two clicks came first, selecting it and letting go: it stays selected
									st.selected = box.id;
									if (opens(box)) toggle(box);
								}}
							>
								<span
									class={[
										'truncate font-mono text-[12px]',
										box.status === 'affected' || box.status === 'removed'
											? 'text-muted'
											: box.signature && box.status === 'modified'
												? 'text-mod'
												: 'text-fg'
									]}>{box.name}</span
								>
								<span class="truncate text-[10.5px] text-muted">{sub(box)}</span>
							</button>
							<span class="hidden group-focus-within:flex group-hover:flex"
								>{@render toDiff(box, 'size-6')}</span
							>

							{#if (box.members || madeUp(box)) && box.kind !== 'more'}
								<button
									type="button"
									class="group/hint relative mr-1.5 flex size-6 shrink-0 items-center justify-center rounded text-[11px] text-muted hover:bg-subtle hover:text-fg"
									aria-label={box.open ? 'Close' : `Show what's in ${box.name}`}
									aria-expanded={box.open}
									aria-busy={loading(box, 'members')}
									onclick={() => toggle(box)}
									>{#if loading(box, 'members')}{@render spinner('size-3')}{:else}{box.open
											? '▾'
											: '▸'}{/if}{@render hint(box, 'members', 'right')}</button
								>
							{/if}
						</div>
						{#each box.rows as row (row.id)}
							<div
								class={[
									'group/row relative flex items-center gap-1.5 border-t border-line/60 px-2.5 transition-opacity',
									flash.has(row.id) ? 'bg-accent/15' : st.selected === row.id && 'bg-subtle',
									focus?.rows && !focus.rows.has(row.id) && preview?.row !== row.id && 'opacity-40'
								]}
								style:height="{ROW_H}px"
								role="group"
								onmouseenter={() => (hovered = row.id)}
								onmouseleave={() => (hovered = box.id)}
							>
								<i class={['size-2 shrink-0 rounded-full', DOT[row.status]]}></i>
								<button
									type="button"
									class={[
										'min-w-0 flex-1 truncate text-left font-mono text-[11.5px]',
										row.status === 'affected' ? 'text-muted' : 'text-fg',
										'cursor-pointer'
									]}
									title="{row.kind} · {row.path}:{row.line}"
									aria-pressed={st.selected === row.id}
									onclick={() => select(row.id)}>{row.name}</button
								>
								<span class="hidden group-hover/row:flex">{@render toDiff(row, 'size-5')}</span>
								{#if canAsk(row, 'users')}
									<button
										type="button"
										class={[
											'group/hint relative text-[11px] text-muted hover:text-fg',
											loading(row, 'users') ? 'block' : 'hidden group-hover/row:block'
										]}
										aria-label="Show what uses {row.name}"
										aria-busy={loading(row, 'users')}
										onclick={() => expand(row, 'users')}
										>{#if loading(row, 'users')}{@render spinner(
												'block size-2.5'
											)}{:else}‹{/if}{@render hint(row, 'users', 'right')}</button
									>
								{/if}
								{#if canAsk(row, 'uses')}
									<button
										type="button"
										class={[
											'group/hint relative text-[11px] text-muted hover:text-fg',
											loading(row, 'uses') ? 'block' : 'hidden group-hover/row:block'
										]}
										aria-label="Show what {row.name} uses"
										aria-busy={loading(row, 'uses')}
										onclick={() => expand(row, 'uses')}
										>{#if loading(row, 'uses')}{@render spinner(
												'block size-2.5'
											)}{:else}›{/if}{@render hint(row, 'uses', 'right')}</button
									>
								{/if}
							</div>
						{/each}
						{#if box.hidden}
							<p
								class="flex items-center border-t border-line/60 px-2.5 text-[10.5px] text-faint"
								style:height="{ROW_H}px"
							>
								{box.hidden} more, unchanged and unused here
							</p>
						{/if}
						<!-- needs attention: a red bar, always; worth a look: a hollow one while it's in focus.
							The bar opens why -->
						{#if hot?.heat.get(box.id)}
							{@const heat = hot.heat.get(box.id)!}
							{@const shown =
								heat.level === 2 || hovered === box.id || st.selected === box.id || card === box.id}
							{#if shown}
								<span
									class="absolute inset-y-0 left-0 w-3"
									role="presentation"
									onmouseenter={() => (peek = box.id)}
									onmouseleave={() => {
										peek = null;
										litHover = null;
									}}
								>
									<button
										type="button"
										class="absolute inset-0 cursor-pointer"
										aria-label="{heat.level === 2 ? 'Needs attention' : 'Worth a look'}: why"
										aria-expanded={card === box.id}
										onclick={() => openCard(card === box.id ? null : box.id)}
									>
										<i
											class={[
												'absolute inset-y-1.5 left-1 w-1 rounded-full',
												heat.level === 2 ? 'bg-(--heat)' : 'border border-(--heat)'
											]}
										></i>
									</button>
									{#if card === box.id || peek === box.id}
										{@render why(box, heat)}
									{/if}
								</span>
							{/if}
						{/if}
						{@render asks(box)}
					</div>
				{/each}
				{#if tip}
					<p
						class={[
							'pointer-events-none absolute z-40 max-w-md -translate-y-1/2 rounded border border-line bg-surface px-2 py-1 font-mono text-[11px] whitespace-pre-line text-muted shadow-raised',
							tip.left ? '-ml-2 -translate-x-full' : 'ml-2'
						]}
						style:left="{tip.x + PAD + st.origin.x}px"
						style:top="{tip.y + PAD + st.origin.y}px"
					>
						{tip.text}
					</p>
				{/if}
			</div>
			<!-- what's selected, its diff beside the map, or its code when the change didn't touch it -->
			{#if shown}
				<aside
					data-panel
					class="absolute top-3 right-3 bottom-3 z-40 flex max-w-[calc(100%-1.5rem)] cursor-default flex-col overflow-hidden rounded-xl border border-line bg-canvas shadow-raised"
					style:width="{panelWidth}px"
				>
					<header class="flex items-center gap-2 border-b border-line px-3 py-2">
						<span class="min-w-0 flex-1">
							<span class="block truncate font-mono text-[12.5px] text-fg">{shown.node.name}</span>
							<span class="block truncate text-[11px] text-muted"
								>{shown.node.path}:{shown.node.line}</span
							>
						</span>
						{#if shown.byFile.length}
							<LayoutToggle bind:layout={() => panelLayout, (next) => (pick = next)} />
						{/if}
						{#if shown.node.hunks.length}
							<button
								type="button"
								class="rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-subtle hover:text-fg"
								onclick={() => onjump(shown.node.hunks[0])}>Open in the diff</button
							>
						{/if}
						<button
							type="button"
							class="grid size-7 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg"
							aria-label="Close"
							onclick={() => (st.selected = null)}>✕</button
						>
					</header>
					<!-- a code character's width, measured: it depends on the font -->
					<span
						class="pointer-events-none invisible absolute font-mono text-[12.5px] whitespace-pre"
						aria-hidden="true"
						{@attach measureChar}>{'0'.repeat(PROBE)}</span
					>
					<div class="relative min-h-0 flex-1 overflow-auto p-2 pl-9" {@attach gutter}>
						<!-- uses inside the file, from where each is to what it uses -->
						{#if arcs.length}
							<svg
								class="pointer-events-none absolute top-0 left-0 w-9 overflow-visible"
								style:height="{margin}px"
								aria-hidden="true"
							>
								{#each arcs as arc, i (i)}
									<path
										d={arc.d}
										fill="none"
										stroke-width="1"
										class={arc.broken ? 'stroke-(--heat)' : 'stroke-faint'}
									/>
									<path d={arc.head} class={arc.broken ? 'fill-(--heat)' : 'fill-faint'} />
								{/each}
							</svg>
						{/if}
						{#if shown.byFile.length}
							{#each shown.byFile as [file, only] (file.id)}
								<FileDiff
									{file}
									{only}
									anchor="map-{file.id}"
									sticky={false}
									expanded
									layout={panelLayout}
									source={{ repo, rev: stop }}
								/>
							{/each}
						{:else}
							{#await getWholeFile({ repo, rev: stop, path: shown.node.path })}
								<p class="p-3 text-[12px] text-muted">Reading the file…</p>
							{:then whole}
								<p class="px-2 pb-2 text-[11px] text-faint">Unchanged, as the head commit has it</p>
								<pre class="twinkleplop overflow-x-auto font-mono text-[12px] leading-5"><code
										>{#each whole.html as html, i (i)}{#if i + 1 === shown.node.line}<span
													class="flex bg-subtle"
													data-line={i + 1}
													{@attach scrollTo}
													><span class="w-10 shrink-0 pr-3 text-right text-muted select-none"
														>{i + 1}</span
													><span class="whitespace-pre">{@html html}</span></span
												>{:else}<span class="flex" data-line={i + 1}
													><span class="w-10 shrink-0 pr-3 text-right text-faint select-none"
														>{i + 1}</span
													><span class="whitespace-pre">{@html html}</span></span
												>{/if}{/each}</code
									></pre>
							{:catch}
								<p class="p-3 text-[12px] text-muted">The file couldn't be read.</p>
							{/await}
						{/if}
					</div>
				</aside>
			{/if}
		</div>
	{/if}
{/if}

<style>
	.arrive {
		animation: arrive 180ms 160ms ease-out backwards;
	}
	@keyframes arrive {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.arrive {
			animation: none;
		}
	}
</style>
