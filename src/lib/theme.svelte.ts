import { MediaQuery } from 'svelte/reactivity';
import { readJson, readText, writeJson, writeText } from '$lib/storage';

/**
 * Light or dark, and which theme draws each. app.html reads the same keys before first
 * paint and applies them again on the event, with the theme's tweaks inline on <html>.
 */

export type Mode = 'system' | 'light' | 'dark';
/** a theme of the reader's own: a copy of a built-in one, its colours tweaked on /theme */
export interface CustomTheme {
	id: string;
	label: string;
	from: BuiltIn;
}

const MODE_KEY = 'sloppy-diff:theme';
const PICK_KEY = { light: 'sloppy-diff:theme-light', dark: 'sloppy-diff:theme-dark' };
const CUSTOM_KEY = 'sloppy-diff:themes';
export const tweaksKey = (id: string) => `sloppy-diff:theme-css:${id}`;

export const MODES: { value: Mode; label: string }[] = [
	{ value: 'system', label: 'System' },
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' }
];

/**
 * The themes that come with it. Each but the two defaults draws with the class of its id,
 * from its CSS in $lib/themes, beside .dark when it's a dark one
 */
const BUILT_INS = [
	{ id: 'light', label: 'Sloppy Light', dark: false },
	{ id: 'catppuccin-latte', label: 'Catppuccin Latte', dark: false },
	{ id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', dark: false },
	{ id: 'solarized-light', label: 'Solarized Light', dark: false },
	{ id: 'dark', label: 'Sloppy Dark', dark: true },
	{ id: 'catppuccin-mocha', label: 'Catppuccin Mocha', dark: true },
	{ id: 'gruvbox-dark', label: 'Gruvbox Dark', dark: true },
	{ id: 'kanagawa-dragon', label: 'Kanagawa Dragon', dark: true },
	{ id: 'nord', label: 'Nord', dark: true },
	{ id: 'tokyo-night', label: 'Tokyo Night', dark: true },
	{ id: 'vesper', label: 'Vesper', dark: true }
] as const;
export type BuiltIn = (typeof BUILT_INS)[number]['id'];

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

	/** a copy of a theme, its tweaks included, to make one's own */
	create(of: string): string {
		const source = this.find(of) ?? this.all[0];
		const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
		const label = `${source.label} copy`;
		writeText(tweaksKey(id), readText(tweaksKey(source.id)));
		this.custom.push({ id, label, from: source.from });
		writeJson(CUSTOM_KEY, this.custom);
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
