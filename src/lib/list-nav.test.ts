import { expect, test } from 'vitest';
import { listNav } from './list-nav';

function press(key: string, active: number, count: number) {
	const seen = { moved: -1, entered: false, prevented: false };
	const event = { key, preventDefault: () => (seen.prevented = true) } as unknown as KeyboardEvent;
	listNav(event, {
		active,
		count,
		onmove: (i) => (seen.moved = i),
		onenter: () => (seen.entered = true)
	});
	return seen;
}

test('arrows move the active option and wrap at either end', () => {
	expect(press('ArrowDown', 0, 3).moved).toBe(1);
	expect(press('ArrowDown', 2, 3).moved).toBe(0);
	expect(press('ArrowUp', 0, 3).moved).toBe(2);
	expect(press('ArrowDown', 0, 0)).toMatchObject({ moved: -1, prevented: true });
});

test('Enter picks, other keys pass through', () => {
	expect(press('Enter', 0, 0)).toMatchObject({ entered: true, prevented: true });
	expect(press('a', 0, 3)).toEqual({ moved: -1, entered: false, prevented: false });
});
