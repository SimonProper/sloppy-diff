import { MediaQuery } from 'svelte/reactivity';
import { readJson, readText, writeJson, writeText } from '$lib/storage';
import { COPIED, THEMES, themeVars } from '$lib/themes/themes';

/**
 * Light or dark, and which theme draws each. app.html reads the same keys before first
 * paint and applies them again on the event, with the theme's tweaks inline on <html>.
 */

export type Mode = 'system' | 'light' | 'dark';
/** a theme of the reader's own: a copy of a built-in one, its colours tweaked on /theme */
export interface CustomTheme {
	id: string;
	label: string;
	/** the built-in theme it was copied from, which draws what the copy doesn't set */
	from: string;
	/**
	 * how it looked when it was copied, as a style attribute holds it: kept as it is, so a
	 * later change to the one it came from doesn't reach it. Tweaks go over it
	 */
	vars?: string;
}

const MODE_KEY = 'sloppy-diff:theme';
const PICK_KEY = { light: 'sloppy-diff:theme-light', dark: 'sloppy-diff:theme-dark' };
const CUSTOM_KEY = 'sloppy-diff:themes';
export const tweaksKey = (id: string) => `sloppy-diff:theme-css:${id}`;
/** CSS rules of the reader's own for a theme, put in a <style> by app.html */
export const rulesKey = (id: string) => `sloppy-diff:theme-rules:${id}`;

/** declarations as a style attribute holds them, later ones winning */
export const joinVars = (...parts: (string | null | undefined)[]) =>
	parts.filter((part) => part?.trim()).join('; ');

export const MODES: { value: Mode; label: string }[] = [
	{ value: 'system', label: 'System' },
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' }
];

/**
 * The themes that come with it: the two defaults, drawn by layout.css itself, then the rest
 * from $lib/themes/themes.ts, each drawn with the class of its id beside .dark when it's a
 * dark one. Each side lists its default first
 */
const BUILT_INS = [
	{ id: 'light', label: 'Sloppy Light', dark: false },
	{ id: 'dark', label: 'Sloppy Dark', dark: true },
	...THEMES.map(({ id, label, dark }) => ({ id, label, dark }))
];

/** every class a theme puts on <html> */
export const CLASSES = ['dark', ...BUILT_INS.map((t) => t.id)];

const builtIn = (id: string) => BUILT_INS.find((t) => t.id === id) ?? BUILT_INS[0];

const prefersDark = new MediaQuery('(prefers-color-scheme: dark)');

class Theme {
	mode = $state((readText(MODE_KEY) as Mode | null) ?? 'system');
	picked = $state({ light: readText(PICK_KEY.light), dark: readText(PICK_KEY.dark) });
	custom = $state(readJson<CustomTheme[]>(CUSTOM_KEY, []));

	all: CustomTheme[] = $derived([
		...BUILT_INS.map((t) => ({ id: t.id, label: t.label, from: t.id })),
		...this.custom
	]);
	isDark = $derived(this.mode === 'system' ? prefersDark.current : this.mode === 'dark');
	/** the theme on screen */
	shown = $derived(this.pickedFor(this.isDark ? 'dark' : 'light'));

	find = (id: string | null) => this.all.find((t) => t.id === id);
	/** as app.html puts them on <html> */
	classesOf = (id: string) => {
		const from = builtIn(this.find(id)?.from ?? 'light');
		return [from.dark && 'dark', from.id !== 'light' && from.id !== 'dark' && from.id].filter(
			(c) => c !== false
		);
	};
	sideOf = (id: string) => (builtIn(this.find(id)?.from ?? 'light').dark ? 'dark' : 'light');
	isBuiltIn = (id: string) => BUILT_INS.some((t) => t.id === id);
	/** light ones, then dark ones, as they're listed */
	sides = $derived(
		(['light', 'dark'] as const).map((side) => ({
			side,
			label: side === 'light' ? 'Light' : 'Dark',
			themes: this.all.filter((t) => this.sideOf(t.id) === side)
		}))
	);

	/** the theme picked for light or dark, the default when that's gone */
	pickedFor(side: 'light' | 'dark'): string {
		const picked = this.find(this.picked[side]);
		return picked && this.sideOf(picked.id) === side ? picked.id : side;
	}

	setMode(mode: Mode) {
		this.mode = mode;
		writeText(MODE_KEY, mode === 'system' ? null : mode);
		apply();
	}

	/** a theme only shows on its own side, so picking a dark one in the light switches over */
	pick(id: string) {
		const side = this.sideOf(id);
		this.picked[side] = id;
		writeText(PICK_KEY[side], id === side ? null : id);
		if ((side === 'dark') === this.isDark) apply();
		else this.setMode(side);
	}

	/**
	 * A copy of a theme to make one's own, frozen as it looks now: its own values, a copy's
	 * frozen ones, its tweaks and its rules. shown is the page's style while it shows the
	 * theme, for the two defaults, which only layout.css knows.
	 */
	create(of: string, shown?: CSSStyleDeclaration): string {
		const source = this.find(of) ?? this.all[0];
		const definition = THEMES.find((t) => t.id === source.id);
		const own = definition
			? themeVars(definition)
			: (source.vars ??
				joinVars(
					...COPIED.map((name) => shown && `${name}: ${shown.getPropertyValue(name).trim()}`)
				));
		const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
		const vars = joinVars(own, readText(tweaksKey(source.id)));
		this.custom.push({ id, label: `${source.label} copy`, from: source.from, vars });
		writeJson(CUSTOM_KEY, this.custom);
		writeText(rulesKey(id), readText(rulesKey(source.id)));
		return id;
	}

	rename(id: string, label: string) {
		const custom = this.custom.find((t) => t.id === id);
		if (!custom) return;
		custom.label = label;
		writeJson(CUSTOM_KEY, this.custom);
	}

	remove(id: string) {
		this.custom = this.custom.filter((t) => t.id !== id);
		writeJson(CUSTOM_KEY, this.custom);
		writeText(tweaksKey(id), null);
		writeText(rulesKey(id), null);
		// a picked one gives way to the default, shown already falls back to it
		for (const side of ['light', 'dark'] as const) {
			if (this.picked[side] === id) {
				this.picked[side] = null;
				writeText(PICK_KEY[side], null);
			}
		}
		apply();
	}
}

export const apply = () => dispatchEvent(new Event('sloppy-diff:theme'));

export const theme = new Theme();
