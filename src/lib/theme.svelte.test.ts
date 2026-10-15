import { expect, test, vi } from 'vitest';

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => stored.get(key) ?? null,
	setItem: (key: string, value: string) => stored.set(key, value),
	removeItem: (key: string) => stored.delete(key)
});
vi.stubGlobal('dispatchEvent', () => true);

const { rulesKey, theme, tweaksKey } = await import('./theme.svelte');

test('a custom theme is a copy of one, picked on its own side and given up when deleted', () => {
	theme.setMode('light');
	stored.set(tweaksKey('vesper'), '--fg: #fff;');
	stored.set(rulesKey('vesper'), '::selection { color: red }');

	const id = theme.create('vesper');
	expect(theme.sideOf(id)).toBe('dark');
	// frozen as it looked: Vesper's own values with its tweaks over them, and its rules
	const vars = theme.find(id)!.vars!;
	expect(vars).toContain('--canvas: #101010');
	expect(vars.endsWith('--fg: #fff;')).toBe(true);
	expect(stored.has(tweaksKey(id))).toBe(false);
	expect(stored.get(rulesKey(id))).toBe('::selection { color: red }');

	// a dark one picked in the light switches to dark, the light pick stays
	theme.pick(id);
	expect(theme.mode).toBe('dark');
	expect(theme.shown).toBe(id);
	expect(theme.pickedFor('light')).toBe('light');
	expect(stored.get('sloppy-diff:theme-dark')).toBe(id);

	theme.remove(id);
	expect(theme.shown).toBe('dark');
	expect(stored.has(rulesKey(id))).toBe(false);
	expect(stored.has('sloppy-diff:theme-dark')).toBe(false);
});
