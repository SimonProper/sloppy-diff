import { describe, expect, test } from 'vitest';
import { currentIndex } from './scroll-spy.svelte';

describe('currentIndex', () => {
	test('the last element scrolled up to the line', () => {
		expect(currentIndex([-800, -100, 110, 600], 120)).toBe(2);
		expect(currentIndex([-800, -100, 400, 900], 120)).toBe(1);
	});

	test('the first element until one reaches the line', () => {
		expect(currentIndex([300, 900], 120)).toBe(0);
	});

	test('elements that are missing are skipped', () => {
		expect(currentIndex([NaN, 300], 120)).toBe(1);
		expect(currentIndex([NaN, NaN], 120)).toBe(-1);
		expect(currentIndex([], 120)).toBe(-1);
	});

	test('at the end of the page, the element jumped to while it is on screen', () => {
		const tops = [-400, 100, 500, 700];
		expect(currentIndex(tops, 120, { height: 900, target: 2 })).toBe(2);
		// scrolled past it, off screen, or never jumped anywhere: the one at the top
		expect(currentIndex(tops, 120, { height: 900, target: 0 })).toBe(1);
		expect(currentIndex(tops, 120, { height: 900, target: -1 })).toBe(1);
		expect(currentIndex([-400, 100, 500, 1000], 120, { height: 900, target: 3 })).toBe(1);
	});
});
