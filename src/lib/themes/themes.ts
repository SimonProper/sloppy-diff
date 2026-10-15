/**
 * The themes that come with sloppy-diff, as their source repos define them, the source named
 * beside every value. vite.config.ts turns them into CSS, one block of variables per theme
 * under its class, served as virtual:themes.css; $lib/theme.svelte.ts lists them.
 *
 * What no variable covers goes in <id>.custom.css beside this file, written by hand: only
 * what no component owns, such as the scrollbars, in @layer base so any utility still wins.
 * See nextstep.custom.css.
 *
 * Plain TypeScript with no imports, so the Vite config can load it.
 */

/** every twinkleplop token, by the role that colours it */
const TOKENS = {
	boolean: 'boolean',
	comment: 'comment',
	identifier: 'variable',
	keyword: 'keyword',
	number: 'number',
	operator: 'operator',
	punctuation: 'punct',
	regex: 'regex',
	string: 'string',
	template: 'string',
	attribute: 'attribute',
	builtin: 'builtin',
	class_name: 'type',
	constant: 'constant',
	decorator: 'decorator',
	lifetime: 'keyword',
	namespace: 'namespace',
	parameter: 'parameter',
	property: 'property',
	type: 'type',
	variable: 'variable',
	variant: 'constant',
	function: 'function',
	attr_name: 'attribute',
	doctype: 'comment',
	entity: 'escape',
	tag_name: 'tag',
	css_variable: 'variable',
	selector: 'tag',
	selector_class: 'type',
	selector_id: 'constant',
	selector_pseudo: 'keyword',
	unit: 'keyword',
	changed: 'mod',
	changed_marker: 'mod',
	deleted: 'del',
	deleted_marker: 'del',
	hash: 'comment',
	heading: 'heading',
	inserted: 'add',
	inserted_marker: 'add',
	label: 'comment',
	autolink: 'string',
	bold: 'fg',
	code: 'string',
	code_block: 'string',
	code_language: 'type',
	italic: 'fg',
	link_text: 'string',
	strike: 'fg',
	url: 'string',
	url_link: 'string',
	url_title: 'string',
	autolink_open: 'string',
	autolink_close: 'string',
	bold_open: 'fg',
	bold_close: 'fg',
	code_open: 'string',
	code_close: 'string',
	italic_open: 'fg',
	italic_close: 'fg',
	link_text_open: 'string',
	link_text_close: 'string',
	strike_open: 'fg',
	strike_close: 'fg',
	blockquote_marker: 'comment',
	code_fence: 'comment',
	front_matter_marker: 'comment',
	heading_marker: 'heading',
	hr: 'comment',
	list_marker: 'keyword',
	task_marker: 'add',
	escape: 'escape',
	hard_break: 'comment',
	expression: 'keyword',
	svelte_block: 'keyword',
	svelte_directive: 'attribute',
	output: 'fg',
	prompt: 'fg',
	prompt_prefix: 'keyword',
	raw_code_block: 'fg',
	raw_front_matter: 'fg',
	raw_json: 'fg',
	raw_markup: 'fg',
	raw_script: 'fg',
	raw_shell: 'fg',
	raw_style: 'fg',
	raw_svelte_expression: 'fg',
	string_escape: 'escape',
	format: 'escape',
	attr_sigil: 'keyword',
	bit: 'number',
	array_table_header: 'heading',
	datetime: 'number',
	block_scalar_header: 'keyword',
	directive: 'decorator',
	doc_marker: 'comment',
	plain_scalar: 'string',
	tag: 'type',
	null: 'constant'
} as const;

const UI = [
	'canvas',
	'surface',
	'subtle',
	'line',
	'fg',
	'muted',
	'faint',
	'add',
	'del',
	'mod',
	'move',
	'sidebar'
] as const;

type Syntax = Exclude<(typeof TOKENS)[keyof typeof TOKENS], (typeof UI)[number]>;
/** a theme can leave these out: moved keeps its default hue, the sidebar takes the canvas */
type Optional = 'move' | 'sidebar';
export type Roles = Record<Exclude<(typeof UI)[number], Optional> | Syntax, string> &
	Partial<Record<Optional, string>>;

/**
 * The corners, fonts and depth of a theme with a look of its own: --radius, the fonts,
 * --float, --raised, --pressed, --sunken, --strip, --card, --control. Values only, the
 * components opt into them, see layout.css
 */
export type Shape = Record<string, string>;

export interface ThemeDef {
	id: string;
	label: string;
	dark: boolean;
	/** what it's after, for the comment over its CSS */
	about: string;
	/** what was taken from it, when it's more than the colours */
	credit?: string;
	roles: Roles;
	shape?: Shape;
}

/** a over b at t, as 6-digit hex: for the few colours a theme only gives with opacity */
export function mix(a: string, b: string, t: number): string {
	const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	const [pa, pb] = [channels(a), channels(b)];
	return (
		'#' +
		pa
			.map((x, i) =>
				roundHalfEven(x * t + pb[i] * (1 - t))
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

// the values were first worked out in Python, whose round() goes to the even neighbour
function roundHalfEven(x: number): number {
	const r = Math.round(x);
	return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** the comment over a theme's CSS, wrapped to 88 columns */
function comment(text: string): string[] {
	const lines: string[] = [];
	for (const word of text.split(' ')) {
		const last = lines.length - 1;
		if (last >= 0 && lines[last].length + 1 + word.length <= 88) lines[last] += ' ' + word;
		else lines.push(word);
	}
	return lines.map(
		(line, i) => (i === 0 ? '/* ' : '   ') + line + (i === lines.length - 1 ? ' */' : '')
	);
}

/** A theme's variables as its CSS sets them, as a style attribute would hold them. */
export function themeVars(theme: ThemeDef): string {
	const { roles, shape } = theme;
	return [
		...UI.filter((key) => roles[key]).map((key) => `--${key}: ${roles[key]!.toLowerCase()}`),
		...Object.entries(shape ?? {}).map(([key, value]) => `--${key}: ${value}`),
		...Object.entries(TOKENS).map(([token, role]) => `--twp-${token}: ${roles[role].toLowerCase()}`)
	].join('; ');
}

/**
 * What a copy of one of the two defaults keeps of it, read off the page while it's shown:
 * layout.css draws those, there's no definition of them here. Its base colours, corners,
 * popover shadow and syntax; the rest is worked out from these or stays flat.
 */
export const COPIED = [
	...UI.filter((key) => key !== 'sidebar').map((key) => `--${key}`),
	'--radius',
	'--float',
	...Object.keys(TOKENS).map((token) => `--twp-${token}`)
];

/** One theme's variables, under its class. */
export function themeCss(theme: ThemeDef): string {
	const { id, label, dark, about, roles, shape } = theme;
	const credit =
		theme.credit ??
		'generated from its own roles: UI from its editor colours, syntax from its highlight groups';
	const rides = dark
		? 'Rides on .dark, anything not set here falls back to it'
		: 'Over the default light theme, anything not set here falls back to it';
	const lines = comment(`${label}, after ${about}, ${credit}. ${rides}`);
	// .dark beside it outweighs :root.dark whatever order the CSS comes in
	lines.push(`${dark ? `:root.dark.${id}` : `:root.${id}`} {`);
	for (const key of UI) if (roles[key]) lines.push(`\t--${key}: ${roles[key].toLowerCase()};`);
	if (shape)
		lines.push('', ...Object.entries(shape).map(([key, value]) => `\t--${key}: ${value};`));
	lines.push('');
	for (const [token, role] of Object.entries(TOKENS))
		lines.push(`\t--twp-${token}: ${roles[role].toLowerCase()};`);
	lines.push('}');
	return lines.join('\n') + '\n';
}

// raunofreiberg/vesper, themes/Vesper-dark-color-theme.json
const v = {
	bg: '#101010',
	fg: '#ffffff',
	orange: '#ffc799',
	mint: '#99ffe4',
	red: '#ff8080',
	gray: '#a0a0a0'
};
const vesper: ThemeDef = {
	id: 'vesper',
	label: 'Vesper',
	dark: true,
	about: 'github.com/raunofreiberg/vesper',
	roles: {
		canvas: v.bg, // editor.background
		surface: '#161616', // tab.activeBackground, editorHoverWidget.background
		subtle: '#1c1c1c', // input.background
		line: '#282828', // editorHoverWidget.border, list.hoverBackground
		fg: v.fg,
		muted: v.gray, // sideBarTitle, statusBar.foreground
		faint: '#505050', // editorLineNumber.foreground
		add: v.mint, // editorGutter.*
		mod: v.orange,
		del: v.red,
		// no fourth hue, moved keeps the default dark one
		comment: mix('#8b8b8b', v.bg, 0x94 / 255), // #8b8b8b94 over the background
		keyword: v.gray,
		operator: v.gray,
		punct: v.gray,
		string: v.mint,
		escape: v.gray,
		regex: v.gray,
		number: v.orange,
		boolean: v.orange,
		constant: v.fg, // variable.other.constant falls to variable
		function: v.orange,
		type: v.orange,
		namespace: v.orange,
		property: v.fg,
		variable: v.fg,
		parameter: v.fg,
		builtin: v.orange,
		tag: v.orange,
		attribute: v.gray, // entity.other.attribute-name, html only is orange
		decorator: v.fg,
		heading: v.orange
	}
};

// rebelot/kanagawa.nvim, colors.lua palette and the dragon theme in themes.lua
const kanagawaDragon: ThemeDef = {
	id: 'kanagawa-dragon',
	label: 'Kanagawa Dragon',
	dark: true,
	about: 'github.com/rebelot/kanagawa.nvim',
	roles: {
		canvas: '#0d0c0c', // bg_m3 dragonBlack0
		surface: '#181616', // bg dragonBlack3
		subtle: '#282727', // bg_p1 dragonBlack4
		line: '#393836', // bg_p2 dragonBlack5
		fg: '#c5c9c5', // dragonWhite
		muted: '#9e9b93', // dragonGray2
		faint: '#625e5a', // nontext dragonBlack6
		add: '#76946a', // vcs autumnGreen
		mod: '#dca561', // vcs autumnYellow
		move: '#a292a3', // dragonPink
		del: '#c34043', // vcs autumnRed
		comment: '#737c73',
		keyword: '#8992a7',
		operator: '#c4746e',
		punct: '#9e9b93',
		string: '#8a9a7b',
		escape: '#c4746e',
		regex: '#c4746e',
		number: '#a292a3',
		boolean: '#b6927b',
		constant: '#b6927b',
		function: '#8ba4b0',
		type: '#8ea4a2',
		namespace: '#8ea4a2', // @module, Structure -> Type
		property: '#c4b28a', // @variable.member = identifier
		variable: '#c5c9c5',
		parameter: '#a6a69c',
		builtin: '#c4746e', // @variable.builtin = special2
		tag: '#949fb5', // @tag -> Tag -> Special = special1
		attribute: '#c4b28a', // @tag.attribute = identifier
		decorator: '#b6927b', // @attribute -> Constant
		heading: '#8ba4b0' // @markup.heading -> Function
	}
};

// catppuccin/palette palette.json, roles from the style guide and catppuccin/nvim. Changed
// text is blue in the style guide's diff section
type Catppuccin = Record<
	| 'rosewater'
	| 'flamingo'
	| 'pink'
	| 'mauve'
	| 'red'
	| 'maroon'
	| 'peach'
	| 'yellow'
	| 'green'
	| 'teal'
	| 'sky'
	| 'sapphire'
	| 'blue'
	| 'lavender'
	| 'text'
	| 'subtext1'
	| 'subtext0'
	| 'overlay2'
	| 'overlay1'
	| 'overlay0'
	| 'surface2'
	| 'surface1'
	| 'surface0'
	| 'base'
	| 'mantle'
	| 'crust',
	string
>;
const catppuccin = (c: Catppuccin): Roles => ({
	canvas: c.mantle,
	surface: c.base,
	subtle: c.surface0,
	line: c.surface1,
	fg: c.text,
	muted: c.subtext0,
	faint: c.overlay1, // subtle, line numbers
	add: c.green,
	mod: c.blue,
	move: c.pink,
	del: c.red,
	comment: c.overlay2,
	keyword: c.mauve,
	operator: c.sky,
	punct: c.overlay2,
	string: c.green,
	escape: c.pink,
	regex: c.pink,
	number: c.peach,
	boolean: c.peach,
	constant: c.peach,
	function: c.blue,
	type: c.yellow,
	namespace: c.yellow,
	property: c.lavender,
	variable: c.text,
	parameter: c.maroon,
	builtin: c.red,
	tag: c.blue,
	attribute: c.yellow,
	decorator: c.yellow,
	heading: c.blue
});
const LATTE: Catppuccin = {
	rosewater: '#dc8a78',
	flamingo: '#dd7878',
	pink: '#ea76cb',
	mauve: '#8839ef',
	red: '#d20f39',
	maroon: '#e64553',
	peach: '#fe640b',
	yellow: '#df8e1d',
	green: '#40a02b',
	teal: '#179299',
	sky: '#04a5e5',
	sapphire: '#209fb5',
	blue: '#1e66f5',
	lavender: '#7287fd',
	text: '#4c4f69',
	subtext1: '#5c5f77',
	subtext0: '#6c6f85',
	overlay2: '#7c7f93',
	overlay1: '#8c8fa1',
	overlay0: '#9ca0b0',
	surface2: '#acb0be',
	surface1: '#bcc0cc',
	surface0: '#ccd0da',
	base: '#eff1f5',
	mantle: '#e6e9ef',
	crust: '#dce0e8'
};
const MOCHA: Catppuccin = {
	rosewater: '#f5e0dc',
	flamingo: '#f2cdcd',
	pink: '#f5c2e7',
	mauve: '#cba6f7',
	red: '#f38ba8',
	maroon: '#eba0ac',
	peach: '#fab387',
	yellow: '#f9e2af',
	green: '#a6e3a1',
	teal: '#94e2d5',
	sky: '#89dceb',
	sapphire: '#74c7ec',
	blue: '#89b4fa',
	lavender: '#b4befe',
	text: '#cdd6f4',
	subtext1: '#bac2de',
	subtext0: '#a6adc8',
	overlay2: '#9399b2',
	overlay1: '#7f849c',
	overlay0: '#6c7086',
	surface2: '#585b70',
	surface1: '#45475a',
	surface0: '#313244',
	base: '#1e1e2e',
	mantle: '#181825',
	crust: '#11111b'
};

// rose-pine/neovim, palette.lua dawn and rose-pine.lua
const p = {
	base: '#faf4ed',
	surface: '#fffaf3',
	overlay: '#f2e9e1',
	muted: '#9893a5',
	subtle: '#797593',
	text: '#464261',
	love: '#b4637a',
	gold: '#ea9d34',
	rose: '#d7827e',
	pine: '#286983',
	foam: '#56949f',
	iris: '#907aa9',
	hlMed: '#dfdad9'
};
const rosePineDawn: ThemeDef = {
	id: 'rose-pine-dawn',
	label: 'Rosé Pine Dawn',
	dark: false,
	about: 'github.com/rose-pine/neovim',
	roles: {
		canvas: p.base,
		surface: p.surface,
		subtle: p.overlay,
		line: p.hlMed,
		fg: p.text,
		muted: p.subtle,
		faint: p.muted,
		// git_add, git_change, git_delete, git_rename
		add: p.foam,
		mod: p.rose,
		move: p.pine,
		del: p.love,
		comment: p.subtle,
		keyword: p.pine,
		operator: p.subtle,
		punct: p.subtle,
		string: p.gold,
		escape: p.pine,
		regex: p.iris,
		number: p.gold,
		boolean: p.rose,
		constant: p.gold,
		function: p.rose,
		type: p.foam,
		namespace: p.text,
		property: p.foam,
		variable: p.text,
		parameter: p.iris,
		builtin: p.love,
		tag: p.foam,
		attribute: p.iris,
		decorator: p.iris,
		heading: p.foam
	}
};

// ellisonleao/gruvbox.nvim, the dark palette and its highlight groups
const g = {
	bg0h: '#1d2021',
	bg0: '#282828',
	bg0s: '#32302f',
	bg1: '#3c3836',
	bg4: '#7c6f64',
	fg1: '#ebdbb2',
	fg4: '#a89984',
	red: '#fb4934',
	green: '#b8bb26',
	yellow: '#fabd2f',
	blue: '#83a598',
	purple: '#d3869b',
	aqua: '#8ec07c',
	orange: '#fe8019',
	gray: '#928374'
};
const gruvboxDark: ThemeDef = {
	id: 'gruvbox-dark',
	label: 'Gruvbox Dark',
	dark: true,
	about: 'github.com/ellisonleao/gruvbox.nvim',
	roles: {
		canvas: g.bg0h,
		surface: g.bg0,
		subtle: g.bg0s,
		line: g.bg1,
		fg: g.fg1,
		muted: g.fg4,
		faint: g.bg4, // LineNr bg4
		// GitSigns*
		add: g.green,
		mod: g.orange,
		move: g.purple,
		del: g.red,
		comment: g.gray,
		keyword: g.red,
		operator: g.orange,
		punct: g.orange, // Delimiter
		string: g.green,
		escape: g.orange,
		regex: g.green,
		number: g.purple,
		boolean: g.purple,
		constant: g.purple,
		function: g.green,
		type: g.yellow,
		namespace: g.fg1,
		property: g.blue,
		variable: g.fg1,
		parameter: g.blue,
		builtin: g.orange,
		tag: g.orange, // Tag -> Special
		attribute: g.blue,
		decorator: g.aqua,
		heading: g.green // Title
	}
};

// folke/tokyonight.nvim, colors/night.lua over storm.lua, groups/base.lua and treesitter.lua
const t = {
	bg: '#1a1b26',
	bgDark: '#16161e',
	bgHl: '#292e42',
	fg: '#c0caf5',
	fgDark: '#a9b1d6',
	gutter: '#3b4261',
	comment: '#565f89',
	dark3: '#545c7e',
	dark5: '#737aa2',
	blue: '#7aa2f7',
	blue1: '#2ac3de',
	blue5: '#89ddff',
	blue6: '#b4f9f8',
	cyan: '#7dcfff',
	green: '#9ece6a',
	green1: '#73daca',
	magenta: '#bb9af7',
	orange: '#ff9e64',
	purple: '#9d7cd8',
	red: '#f7768e',
	yellow: '#e0af68',
	gitAdd: '#449dab',
	gitChange: '#6183bb',
	gitDelete: '#914c54'
};
const tokyoNight: ThemeDef = {
	id: 'tokyo-night',
	label: 'Tokyo Night',
	dark: true,
	about: 'github.com/folke/tokyonight.nvim',
	roles: {
		canvas: t.bgDark,
		surface: t.bg,
		subtle: t.bgHl,
		line: t.gutter,
		fg: t.fg,
		muted: t.dark5,
		faint: t.dark3,
		add: t.gitAdd,
		mod: t.gitChange,
		move: t.magenta,
		del: t.gitDelete,
		comment: t.comment,
		keyword: t.purple,
		operator: t.blue5,
		punct: t.fgDark, // brackets
		string: t.green,
		escape: t.magenta,
		regex: t.blue6,
		number: t.orange,
		boolean: t.orange,
		constant: t.orange,
		function: t.blue,
		type: t.blue1,
		namespace: t.cyan, // @module -> Include -> PreProc
		property: t.green1,
		variable: t.fg,
		parameter: t.yellow,
		builtin: t.red,
		tag: t.magenta, // @tag -> Label -> Statement
		attribute: t.green1,
		decorator: t.cyan,
		heading: t.blue
	}
};

// nordtheme/vim, colors/nord.vim, roles as nordtheme.com's docs give them
const n = [
	'#2e3440',
	'#3b4252',
	'#434c5e',
	'#4c566a',
	'#d8dee9',
	'#e5e9f0',
	'#eceff4',
	'#8fbcbb',
	'#88c0d0',
	'#81a1c1',
	'#5e81ac',
	'#bf616a',
	'#d08770',
	'#ebcb8b',
	'#a3be8c',
	'#b48ead'
];
const nord: ThemeDef = {
	id: 'nord',
	label: 'Nord',
	dark: true,
	about: 'github.com/nordtheme/vim',
	roles: {
		canvas: n[0], // Normal
		surface: n[0],
		subtle: n[1], // CursorLine
		line: n[2], // VertSplit
		fg: n[4],
		muted: mix(n[4], n[0], 0.65), // nord has no secondary text colour
		faint: n[3], // LineNr
		// GitGutter*
		add: n[14],
		mod: n[13],
		move: n[15],
		del: n[11],
		comment: '#616e88', // nord3 bright
		keyword: n[9],
		operator: n[9],
		punct: n[6], // Delimiter
		string: n[14],
		escape: n[13],
		regex: n[13],
		number: n[15],
		boolean: n[9],
		constant: n[4],
		function: n[8],
		type: n[7],
		namespace: n[4],
		property: n[4],
		variable: n[4],
		parameter: n[4],
		builtin: n[9],
		tag: n[9],
		attribute: n[7],
		decorator: n[12],
		heading: n[8]
	}
};

// altercation/vim-colors-solarized, light: the base tones swapped, canonical #859900 green
const s = {
	base01: '#586e75',
	base00: '#657b83',
	base1: '#93a1a1',
	base2: '#eee8d5',
	base3: '#fdf6e3',
	yellow: '#b58900',
	orange: '#cb4b16',
	red: '#dc322f',
	violet: '#6c71c4',
	blue: '#268bd2',
	cyan: '#2aa198',
	green: '#859900'
};
const solarizedLight: ThemeDef = {
	id: 'solarized-light',
	label: 'Solarized Light',
	dark: false,
	about: 'github.com/altercation/vim-colors-solarized',
	roles: {
		canvas: s.base2,
		surface: s.base3,
		subtle: s.base2,
		line: mix(s.base1, s.base3, 0.3), // between, solarized has no border tone
		fg: s.base00,
		muted: s.base1,
		faint: mix(s.base1, s.base3, 0.6),
		// Diff*
		add: s.green,
		mod: s.yellow,
		move: s.violet,
		del: s.red,
		comment: s.base1,
		keyword: s.green, // Statement
		operator: s.green,
		punct: s.base00,
		string: s.cyan, // Constant
		escape: s.red, // Special
		regex: s.red,
		number: s.cyan,
		boolean: s.cyan,
		constant: s.cyan,
		function: s.blue, // Identifier
		type: s.yellow,
		namespace: s.orange, // PreProc
		property: s.blue,
		variable: s.blue,
		parameter: s.blue,
		builtin: s.red,
		tag: s.blue, // htmlTagName
		attribute: s.base00, // htmlArg
		decorator: s.orange,
		heading: s.orange // Title
	}
};

// microsoft/vscode, extensions/theme-defaults/themes/hc_black.json and hc_light.json for the
// syntax, the hcDark and hcLight defaults in platform/theme/common/colors for the UI
const highContrast = (
	bg: string,
	fg: string,
	border: string,
	focus: string,
	inserted: string,
	removed: string
) => ({
	canvas: bg,
	surface: bg,
	line: border, // contrastBorder outlines everything
	fg,
	muted: mix(fg, bg, 0.7), // descriptionForeground, foreground at 70%
	// diffEditor.*TextBorder
	add: inserted,
	mod: focus,
	del: removed
});
const highContrastDark: ThemeDef = {
	id: 'high-contrast-dark',
	label: 'High Contrast Dark',
	dark: true,
	about: "VS Code's Dark High Contrast",
	roles: {
		...highContrast('#000000', '#ffffff', '#6fc3df', '#f38518', '#33ff2e', '#ff008f'),
		subtle: '#1f1f1f', // nothing hovers in HC, outlines do; a step off black to see it
		faint: '#7c7c7c', // editorWhitespace.foreground
		move: '#c586c0',
		comment: '#7ca668',
		keyword: '#569cd6',
		operator: '#d4d4d4',
		punct: '#ffffff',
		string: '#ce9178',
		escape: '#569cd6',
		regex: '#d16969',
		number: '#b5cea8',
		boolean: '#569cd6',
		constant: '#9cdcfe',
		function: '#dcdcaa',
		type: '#4ec9b0',
		namespace: '#4ec9b0',
		property: '#9cdcfe',
		variable: '#9cdcfe',
		parameter: '#9cdcfe',
		builtin: '#569cd6',
		tag: '#569cd6',
		attribute: '#9cdcfe',
		decorator: '#569cd6',
		heading: '#6796e6'
	}
};
const highContrastLight: ThemeDef = {
	id: 'high-contrast-light',
	label: 'High Contrast Light',
	dark: false,
	about: "VS Code's Light High Contrast",
	roles: {
		...highContrast('#ffffff', '#292929', '#0f4a85', '#006bbd', '#374e06', '#ad0707'),
		subtle: '#ececec',
		faint: '#6e6e6e',
		move: '#800080',
		comment: '#515151',
		keyword: '#0f4a85',
		operator: '#000000',
		punct: '#292929',
		string: '#0f4a85',
		escape: '#ee0000',
		regex: '#811f3f',
		number: '#096d48',
		boolean: '#0f4a85',
		constant: '#02715d',
		function: '#5e2cbc',
		type: '#185e73',
		namespace: '#185e73',
		property: '#001080',
		variable: '#001080',
		parameter: '#001080',
		builtin: '#0f4a85',
		tag: '#0f4a85',
		attribute: '#264f78',
		decorator: '#0f4a85',
		heading: '#0f4a85'
	}
};

// ekmas/neobrutalism-components, src/styling/globals.css: the blue page, white cards, black
// borders and hard shadows. It has no syntax colours, those are its chart colours darkened
// to read on white
const nb = {
	bg: '#dcebfe',
	card: '#ffffff',
	ink: '#000000',
	main: '#5294ff',
	red: '#ff4d50',
	yellow: '#facc00',
	green: '#05e17a',
	violet: '#7a83ff'
};
const deep = (c: string) => mix(c, '#000000', 0.62);
const neobrutalism: ThemeDef = {
	id: 'neobrutalism',
	label: 'Neobrutalism',
	dark: false,
	about: 'neobrutalism.dev',
	credit: 'its colours, corners and shadows',
	roles: {
		canvas: nb.bg, // --background, hsl(214 95% 93%)
		surface: nb.card, // --secondary-background
		subtle: nb.bg,
		line: nb.ink, // --border
		fg: nb.ink,
		muted: mix(nb.ink, nb.card, 0.75),
		faint: mix(nb.ink, nb.card, 0.55),
		// --chart-*, the green and yellow darkened a little: here they're text too, the counts
		add: mix(nb.green, '#000000', 0.7),
		mod: mix(nb.yellow, '#000000', 0.7),
		move: nb.violet,
		del: nb.red,
		comment: mix(nb.ink, nb.card, 0.55),
		keyword: deep(nb.violet),
		operator: nb.ink,
		punct: nb.ink,
		string: deep(nb.green),
		escape: deep(nb.red),
		regex: deep(nb.red),
		number: deep(nb.red),
		boolean: deep(nb.red),
		constant: deep(nb.red),
		function: deep(nb.main),
		type: mix(nb.yellow, '#000000', 0.5),
		namespace: nb.ink,
		property: nb.ink,
		variable: nb.ink,
		parameter: nb.ink,
		builtin: deep(nb.violet),
		tag: deep(nb.main),
		attribute: deep(nb.violet),
		decorator: deep(nb.violet),
		heading: nb.ink
	},
	shape: {
		radius: '5px', // --border-radius
		'font-sans': "'DM Sans', var(--sans-stack)", // --base-font-family
		// --shadow, the hard offset of --box-shadow-x/y: on cards and popovers as it has them,
		// halved for the small buttons here, which press flat
		float: '4px 4px 0 0 #000000',
		card: '4px 4px 0 0 #000000',
		raised: '2px 2px 0 0 #000000',
		pressed: '0 0 #0000'
	}
};

// NeXTSTEP: the MegaPixel display's greys, black text on light grey panels and white text
// views, square corners and Helvetica. Its bezels are lit from the top left: buttons stand
// out of the panel and are pushed in while held, fields and text views sink into it, bars
// are lit along their top. Its editors drew code in black alone, so the syntax stays grey
// and only the diff has colour
const ns = { black: '#000000', dark: '#555555', light: '#aaaaaa', white: '#ffffff' };
const nextstep: ThemeDef = {
	id: 'nextstep',
	label: 'NeXTSTEP',
	dark: false,
	about: "NeXT Computer's NeXTSTEP",
	credit: 'its greys, bezels, corners and font',
	roles: {
		canvas: ns.light,
		surface: ns.white,
		subtle: mix(ns.light, ns.white, 0.5),
		// lines a step lighter than the text, so a focused field's darker border shows
		line: '#777777',
		fg: ns.black,
		muted: '#333333',
		faint: ns.dark,
		add: '#006000',
		mod: '#806000',
		move: '#600080',
		del: '#b00000',
		comment: ns.dark,
		keyword: ns.black,
		operator: ns.black,
		punct: ns.black,
		string: ns.dark,
		escape: ns.dark,
		regex: ns.dark,
		number: ns.black,
		boolean: ns.black,
		constant: ns.black,
		function: ns.black,
		type: ns.black,
		namespace: ns.black,
		property: ns.black,
		variable: ns.black,
		parameter: ns.black,
		builtin: ns.black,
		tag: ns.black,
		attribute: ns.dark,
		decorator: ns.dark,
		heading: ns.black
	},
	shape: {
		radius: '0px',
		'font-sans': 'Helvetica, var(--sans-stack)',
		control: 'var(--canvas)',
		raised: 'inset 1px 1px 0 #ffffff, inset -1px -1px 0 #555555, 1px 1px 0 #000000',
		pressed: 'inset 1px 1px 0 #555555, inset -1px -1px 0 #ffffff',
		// outside the border, which the field's own content would cover inside
		sunken: '-1px -1px 0 #555555, 1px 1px 0 #ffffff',
		card: '-1px -1px 0 #555555, 1px 1px 0 #ffffff',
		// lit along the top over a face of panel grey, painted by the shadow so a bar on white
		// turns grey too
		strip: 'inset 0 1px 0 #ffffff, inset 0 0 0 100vmax var(--canvas)',
		float: 'inset 1px 1px 0 #ffffff, inset -1px -1px 0 #000000'
	}
};

/** in the order they're listed, the light ones then the dark ones */
export const THEMES: ThemeDef[] = [
	{
		id: 'catppuccin-latte',
		label: 'Catppuccin Latte',
		dark: false,
		about: 'github.com/catppuccin/catppuccin',
		roles: catppuccin(LATTE)
	},
	highContrastLight,
	neobrutalism,
	nextstep,
	rosePineDawn,
	solarizedLight,
	{
		id: 'catppuccin-mocha',
		label: 'Catppuccin Mocha',
		dark: true,
		about: 'github.com/catppuccin/catppuccin',
		roles: catppuccin(MOCHA)
	},
	gruvboxDark,
	highContrastDark,
	kanagawaDragon,
	nord,
	tokyoNight,
	vesper
];
