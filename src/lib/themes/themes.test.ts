import { describe, expect, test } from 'vitest';
import { mix, THEMES, themeCss } from './themes';

describe('mix', () => {
	test('is a over b at t, rounded as the values were first worked out', () => {
		expect(mix('#ffffff', '#000000', 0.5)).toBe('#808080');
		expect(mix('#8b8b8b', '#101010', 0x94 / 255)).toBe('#575757');
		expect(mix('#ff0000', '#0000ff', 1)).toBe('#ff0000');
	});
});

describe('the themes', () => {
	test('each has an id of its own, a class it can be drawn by', () => {
		const ids = THEMES.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
	});

	test('give every syntax token a colour, a dark one over .dark', () => {
		for (const theme of THEMES) {
			const css = themeCss(theme);
			expect(css).toContain(theme.dark ? `:root.dark.${theme.id} {` : `:root.${theme.id} {`);
			expect(css).not.toMatch(/undefined|NaN/);
			expect(css).toContain('--twp-keyword: #');
			expect(css).toContain('--twp-null: #');
		}
	});

	test('carry their shape along with their colours', () => {
		const nextstep = themeCss(THEMES.find((t) => t.id === 'nextstep')!);
		expect(nextstep).toContain('\t--radius: 0px;');
		expect(nextstep).toContain('\t--canvas: #aaaaaa;');
	});
});
