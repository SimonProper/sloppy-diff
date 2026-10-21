import type { Box, Line } from './layout';

/** past this many users a changed box is worth a look on that alone */
const MANY = 5;

/** Why a box needs attention, and the boxes the reason is about. */
export interface Reason {
	text: string;
	/** 2 a fact that something's wrong or untested, 1 worth a look */
	level: 1 | 2;
	ids: string[];
}

export interface Heat {
	level: 1 | 2;
	/** the worst first */
	reasons: Reason[];
}

/**
 * Where on the map a reviewer should look first, by rules, never a hidden score:
 * attention for a use that no longer type-checks, or an outside that changed with users
 * and no test; a look for an outside that changed under users that still compile, a test
 * left as it was, many users. A caller the change didn't update is marked as well as what
 * changed, it's where the fix would go. `warm` are the uses from those callers.
 */
export function heatOf(
	boxes: Box[],
	lines: Line[]
): { heat: Map<string, Heat>; warm: Set<string> } {
	const byId = new Map(boxes.map((b) => [b.id, b]));
	const reasons = new Map<string, Reason[]>();
	const add = (id: string, reason: Reason) =>
		(reasons.get(id) ?? reasons.set(id, []).get(id)!).push(reason);
	const warm = new Set<string>();
	const between = lines.filter((l) => l.fromBox !== l.toBox);
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

	for (const [to, into] of Map.groupBy(between, (l) => l.toBox)) {
		const box = byId.get(to);
		if (!box || box.status === 'affected' || box.kind === 'tests') continue;
		const users = [...new Set(into.map((l) => l.fromBox))].map((id) => byId.get(id)!);
		const tests = users.filter((u) => u.kind === 'tests');
		const others = users.filter((u) => u.kind !== 'tests');
		const count = others.reduce((n, u) => n + (u.kind === 'more' ? u.folded : 1), 0);
		const ids = others.map((u) => u.id);

		const broken = [...new Set(into.filter((l) => l.broken).map((l) => l.fromBox))];
		if (broken.length) {
			add(to, {
				level: 2,
				text: `${plural(broken.length, 'use', 'uses')} no longer type-check`,
				ids: broken
			});
		}
		if (box.signature && count) {
			add(to, {
				level: tests.length ? 1 : 2,
				text: `Signature changed, ${plural(count, 'user', 'users')}${tests.length ? '' : ', no test'}`,
				ids
			});
		}
		if (box.signature && tests.length && tests.every((t) => t.status === 'affected')) {
			add(to, {
				level: 1,
				text: tests.length === 1 ? 'Its test is unchanged' : 'Its tests are unchanged',
				ids: tests.map((t) => t.id)
			});
		}
		if (count >= MANY) add(to, { level: 1, text: `Used by ${count}`, ids });
	}

	for (const l of between) {
		const [user, used] = [byId.get(l.fromBox), byId.get(l.toBox)];
		if (!user || !used || user.kind === 'more') continue;
		if (l.broken) {
			add(user.id, {
				level: 2,
				text: `Its use of ${used.name} no longer type-checks: ${l.broken}`,
				ids: [used.id]
			});
			warm.add(`${l.from}>${l.to}`);
		} else if (
			used.signature &&
			used.status !== 'affected' &&
			user.status === 'affected' &&
			user.kind !== 'tests'
		) {
			add(user.id, {
				level: 1,
				text: `${used.name}'s signature changed, this use wasn't`,
				ids: [used.id]
			});
			warm.add(`${l.from}>${l.to}`);
		}
	}

	const heat = new Map<string, Heat>();
	for (const [id, list] of reasons) {
		list.sort((a, b) => b.level - a.level);
		heat.set(id, { level: list[0].level, reasons: list });
	}
	return { heat, warm };
}

/** The boxes to look at first: attention before a look, then by how many reasons. */
export function ranked(heat: Map<string, Heat>, limit = 5): string[] {
	const worst = (h: Heat) => h.reasons.filter((r) => r.level === 2).length;
	return [...heat]
		.sort(
			([, a], [, b]) =>
				b.level - a.level || worst(b) - worst(a) || b.reasons.length - a.reasons.length
		)
		.slice(0, limit)
		.map(([id]) => id);
}
