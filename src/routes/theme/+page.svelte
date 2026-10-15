<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import FileDiff from '$lib/components/FileDiff.svelte';
	import { readText, writeText } from '$lib/storage';
	import { apply, CLASSES, joinVars, rulesKey, theme, tweaksKey } from '$lib/theme.svelte';

	let { data } = $props();

	// layout.css's base colours and the main syntax ones, everything else is mixed from
	// these or falls back to them. Any other variable can still go in the CSS below
	const GROUPS: { label: string; tokens: [name: string, label: string][] }[] = [
		{
			label: 'Surfaces',
			tokens: [
				['--canvas', 'Canvas'],
				['--surface', 'Surface'],
				['--subtle', 'Subtle'],
				['--line', 'Line'],
				['--sidebar', 'Sidebar']
			]
		},
		{
			label: 'Text',
			tokens: [
				['--fg', 'Text'],
				['--muted', 'Muted'],
				['--faint', 'Faint']
			]
		},
		{
			label: 'Changes',
			tokens: [
				['--add', 'Added'],
				['--del', 'Removed'],
				['--mod', 'Modified'],
				['--move', 'Moved']
			]
		},
		{
			label: 'Syntax',
			tokens: [
				['--twp-keyword', 'Keyword'],
				['--twp-string', 'String'],
				['--twp-comment', 'Comment'],
				['--twp-function', 'Function'],
				['--twp-number', 'Number'],
				['--twp-type', 'Type'],
				['--twp-class_name', 'Class'],
				['--twp-property', 'Property'],
				['--twp-tag_name', 'Tag'],
				['--twp-operator', 'Operator'],
				['--twp-punctuation', 'Punctuation']
			]
		}
	];
	const NAMES = GROUPS.flatMap((group) => group.tokens.map(([name]) => name));

	// layout.css's shape: the radius every corner is scaled from, and the fonts, each picked
	// one in front of the stack it falls back to
	const FONTS: [name: string, stack: string, label: string, suggestions: string[]][] = [
		[
			'--font-sans',
			'--sans-stack',
			'Text font',
			['Inter', 'Geist', 'IBM Plex Sans', 'Helvetica Neue']
		],
		[
			'--font-mono',
			'--mono-stack',
			'Code font',
			['JetBrains Mono', 'Fira Code', 'Berkeley Mono', 'Cascadia Code', 'IBM Plex Mono', 'Menlo']
		]
	];
	const SHAPE = ['--radius', ...FONTS.map(([name]) => name)];
	// the radius in px, written in px or rem
	const px = (value: string) => parseFloat(value) * (value.endsWith('rem') ? 16 : 1);

	// the theme being customized is put on screen while here, whatever's picked, and
	// the picked one comes back on the way out
	let editing = $state(theme.shown);
	const current = $derived(theme.find(editing));
	// which have tweaks or rules stored, for the list
	const stored = () =>
		theme.all.filter((t) => readText(tweaksKey(t.id)) || readText(rulesKey(t.id))).map((t) => t.id);
	let customized = $state(stored());

	// inline on <html>, as app.html puts them: a copy's frozen values, then the tweaks, kept
	// apart in a style of their own so they can be read back, reset and stored on their own
	const root = document.documentElement;
	const tweaks = document.createElement('div').style;
	const draw = () => (root.style.cssText = joinVars(current?.vars, tweaks.cssText));
	// the reader's rules for the theme, in the <style> app.html made for them
	const rulesStyle = () => document.getElementById('theme-rules');
	let rules = $state('');
	let values = $state<Record<string, string>>({});
	let tweaked = $state<string[]>([]);
	let css = $state('');
	let fonts = $state<Record<string, string>>({});

	/** the first font of a stack, the system's own named so */
	const firstFont = (stack: string) => {
		const font = stack.split(',')[0].replace(/["']/g, '').trim();
		return font.startsWith('ui-') ? 'System' : font;
	};
	/** the font picked for a theme on top of its own, out of the stack behind it */
	const family = (name: string) => {
		const picked = tweaks.getPropertyValue(name);
		return picked && firstFont(picked);
	};

	function readValues() {
		const style = getComputedStyle(root);
		values = Object.fromEntries(
			[...NAMES, ...SHAPE].map((name) => [name, style.getPropertyValue(name).trim()])
		);
		tweaked = [...NAMES, ...SHAPE].filter((name) => tweaks.getPropertyValue(name));
		fonts = Object.fromEntries(FONTS.map(([name]) => [name, family(name)]));
	}

	function refresh() {
		readValues();
		css = tweaks.cssText.replaceAll('; ', ';\n');
	}

	$effect(() => {
		root.classList.remove(...CLASSES);
		root.classList.add(...theme.classesOf(editing));
		tweaks.cssText = readText(tweaksKey(editing)) ?? '';
		draw();
		rules = readText(rulesKey(editing)) ?? '';
		const style = rulesStyle();
		if (style) style.textContent = rules;
		refresh();
	});
	// leaving, app.html puts the picked theme back, over none of the ones shown here
	$effect(() => () => {
		root.classList.remove(...CLASSES);
		apply();
	});

	function store(css: string) {
		writeText(tweaksKey(editing), css.trim() ? css : null);
		customized = stored();
	}

	function save() {
		draw();
		store(tweaks.cssText);
		refresh();
	}

	function set(name: string, value: string) {
		tweaks.setProperty(name, value);
		save();
	}

	function reset(name: string) {
		tweaks.removeProperty(name);
		save();
	}

	function setFont(name: string, stack: string, picked: string) {
		if (picked.trim()) set(name, `"${picked.trim()}", var(${stack})`);
		else reset(name);
	}

	function resetAll() {
		tweaks.cssText = '';
		save();
	}

	// the text is kept as typed while it's being edited, half a declaration included,
	// and tidied to what the browser kept once it's left
	function editCss(text: string) {
		// an LLM's reply pasted whole: a code fence or a :root { } around it is let go
		const declarations = text.replace(/```\w*/g, '').replace(/^[^{]*\{|\}/g, '');
		tweaks.cssText = declarations;
		draw();
		store(declarations);
		readValues();
	}

	function editRules(text: string) {
		rules = text;
		const style = rulesStyle();
		if (style) style.textContent = text;
		writeText(rulesKey(editing), text.trim() ? text : null);
		customized = stored();
	}

	function create() {
		editing = theme.create(editing, getComputedStyle(root));
		customized = stored();
	}

	// back to the built-in one it was copied from
	function remove() {
		const from = current?.from ?? 'light';
		theme.remove(editing);
		editing = from;
		customized = stored();
	}

	// for an LLM to fill in: the template is the theme being edited, and the theme
	// wanted goes at the very end, typed after pasting
	function prompt() {
		const template = GROUPS.map(
			(group) =>
				`/* ${group.label} */\n` +
				group.tokens.map(([name, label]) => `${name}: ${values[name]}; /* ${label} */`).join('\n')
		).join('\n\n');
		return `I'm theming a code review app, a diff viewer with syntax highlighting. Make me a ${theme.sideOf(editing)} colour theme in the style I name at the end.

Fill in this template, its values are the current ${current?.label || 'theme'}'s. Reply with only the CSS declarations, one per line, every colour a 6-digit hex like #1f1f28.

${template}

What they're for:
- --canvas is the page, --surface panels and the code, --subtle hovers and code blocks, --line borders, --sidebar the lists beside the diff (the page's colour unless set).
- --fg is text, --muted secondary text, --faint the quietest (line numbers, hints). --fg and --muted have to stay readable on --surface.
- --add, --del, --mod and --move mark added, removed, modified and moved code. Line backgrounds are mixed from them over --surface, so pick hues that stay clear there.
- --twp-* colour the syntax. Any other --twp-<token> can be set too, such as --twp-constant, --twp-variable, --twp-parameter, --twp-builtin, --twp-attribute or --twp-regex.
- If the style has a shape of its own, --radius sets every corner (${px(values['--radius'] ?? '8px')}px now, 0 is square), and --font-sans and --font-mono a font, written as "Font Name", var(--sans-stack) or "Font Name", var(--mono-stack) so there's a fallback.
- It can give the page depth with box-shadows, 0 0 #0000 being none: --raised for buttons, --pressed for one held down, --sunken for text fields, --strip for the bars along the top and over panels, --card for a file's card, and --control for a button's face colour.

The theme I want: `;
	}

	let copied = $state(false);
	async function copyPrompt() {
		await navigator.clipboard.writeText(prompt()).catch(() => {});
		copied = true;
		setTimeout(() => (copied = false), 1200);
	}

	let back = $state('/');
	afterNavigate(({ from }) => {
		if (from?.url) back = from.url.pathname + from.url.search;
	});
</script>

{#snippet resetButton(name: string, label: string)}
	<button
		type="button"
		class={[
			'grid size-5 shrink-0 place-items-center rounded-sm text-faint hover:text-fg',
			!tweaked.includes(name) && 'invisible'
		]}
		title={theme.isBuiltIn(editing) ? `Back to ${current?.label}'s` : 'Back to how it was copied'}
		aria-label="Reset {label}"
		onclick={() => reset(name)}
	>
		<svg
			viewBox="0 0 16 16"
			class="size-3"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg
		>
	</button>
{/snippet}

<svelte:head>
	<title>Theme · sloppy diff</title>
</svelte:head>

<header
	class="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-canvas px-4 shadow-strip"
>
	<a
		href={back}
		class="grid size-8 place-items-center rounded-lg border border-line bg-control text-muted shadow-raised hover:border-muted hover:text-fg active:shadow-pressed"
		title="Back"
		aria-label="Back"
	>
		<svg
			viewBox="0 0 16 16"
			class="size-3.5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="M9.5 3.5 5 8l4.5 4.5" /></svg
		>
	</a>
	<h1 class="text-[13px] font-medium">Customize theme</h1>
</header>

<main
	class="mx-auto grid max-w-6xl gap-8 px-4 py-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start"
>
	<section aria-label="Colours" class="flex flex-col gap-6">
		<div>
			{#each theme.sides as { side, label, themes }, i (side)}
				<h2
					class={['mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase', i && 'mt-5']}
				>
					{label}
				</h2>
				<ul class="flex flex-col gap-px">
					{#each themes as option (option.id)}
						{@const active = option.id === editing}
						<li>
							<button
								type="button"
								class={[
									'flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px]',
									active
										? 'bg-subtle font-medium text-fg'
										: 'text-muted hover:bg-subtle hover:text-fg'
								]}
								aria-pressed={active}
								onclick={() => (editing = option.id)}
							>
								<span class="truncate">{option.label || 'Untitled'}</span>
								<span class="ml-auto shrink-0 text-[11px] font-normal text-faint">
									{[
										option.id === theme.shown && 'In use',
										customized.includes(option.id) && 'Customized'
									]
										.filter(Boolean)
										.join(' · ')}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/each}
			<button
				type="button"
				class="mt-1 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[12.5px] text-muted hover:bg-subtle hover:text-fg"
				title="A copy of {current?.label || 'this theme'} to make your own"
				onclick={create}
			>
				<svg
					viewBox="0 0 16 16"
					class="size-3"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"><path d="M8 3v10M3 8h10" /></svg
				>
				New theme
			</button>
		</div>

		<div class="-mb-3 flex h-7 items-center gap-3">
			{#if theme.isBuiltIn(editing)}
				<h2 class="text-[12px] text-muted">
					<span class="font-medium text-fg">{current?.label}</span> colours
				</h2>
			{:else}
				<input
					class="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[12.5px] font-medium text-fg shadow-sunken outline-none focus:border-muted"
					value={current?.label}
					placeholder="Untitled"
					aria-label="Theme name"
					oninput={(event) => theme.rename(editing, event.currentTarget.value)}
				/>
				<button type="button" class="text-[12px] text-muted hover:text-del" onclick={remove}>
					Delete
				</button>
			{/if}
			{#if tweaked.length}
				<button
					type="button"
					class="ml-auto text-[12px] text-muted hover:text-fg"
					onclick={resetAll}
				>
					Reset all
				</button>
			{/if}
		</div>

		<div>
			<h2 class="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">Shape</h2>
			<ul class="flex flex-col">
				<li class="flex h-8 items-center gap-2.5">
					<span
						class={[
							'w-16 shrink-0 text-[12.5px]',
							tweaked.includes('--radius') ? 'font-medium text-fg' : 'text-muted'
						]}>Corners</span
					>
					<input
						type="range"
						class="min-w-0 flex-1 accent-fg"
						min="0"
						max="20"
						value={px(values['--radius'] ?? '0')}
						aria-label="Corners"
						oninput={(event) => set('--radius', `${event.currentTarget.value}px`)}
					/>
					<span class="w-9 shrink-0 text-right font-mono text-[11px] text-faint"
						>{px(values['--radius'] ?? '0')}px</span
					>
					{@render resetButton('--radius', 'Corners')}
				</li>
				{#each FONTS as [name, stack, label, suggestions] (name)}
					<li class="flex h-8 items-center gap-2.5">
						<span
							class={[
								'w-16 shrink-0 text-[12.5px]',
								tweaked.includes(name) ? 'font-medium text-fg' : 'text-muted'
							]}>{label}</span
						>
						<input
							class="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[12px] text-fg shadow-sunken outline-none placeholder:text-faint focus:border-muted"
							list="{name}-fonts"
							placeholder={firstFont(values[name] ?? '')}
							spellcheck="false"
							value={fonts[name]}
							aria-label={label}
							onchange={(event) => setFont(name, stack, event.currentTarget.value)}
						/>
						<datalist id="{name}-fonts">
							{#each suggestions as font (font)}<option value={font}></option>{/each}
						</datalist>
						{@render resetButton(name, label)}
					</li>
				{/each}
			</ul>
		</div>

		{#each GROUPS as group (group.label)}
			<div>
				<h2 class="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">
					{group.label}
				</h2>
				<ul class="flex flex-col">
					{#each group.tokens as [name, label] (name)}
						{@const changed = tweaked.includes(name)}
						<li class="flex h-8 items-center gap-2.5">
							<input
								type="color"
								class="size-6 shrink-0 cursor-pointer rounded-md border border-line bg-transparent p-0 shadow-sunken [&::-moz-color-swatch]:rounded-[calc(var(--radius-md)-1px)] [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-[calc(var(--radius-md)-1px)] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
								value={values[name]}
								aria-label={label}
								oninput={(event) => set(name, event.currentTarget.value)}
							/>
							<span class={['text-[12.5px]', changed ? 'font-medium text-fg' : 'text-muted']}>
								{label}
							</span>
							<span class="ml-auto font-mono text-[11px] text-faint">{values[name]}</span>
							{@render resetButton(name, label)}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</section>

	<div class="flex min-w-0 flex-col gap-6 lg:sticky lg:top-18">
		<FileDiff file={data.file} sticky={false} expanded />

		<div class="flex flex-col gap-1.5">
			<div class="flex items-baseline gap-3">
				<label for="theme-css" class="text-[11px] font-medium tracking-wide text-faint uppercase"
					>CSS</label
				>
				<button
					type="button"
					class="ml-auto text-[12px] text-muted hover:text-fg"
					title="A prompt with these colours as a template: paste it into an LLM, name the theme you want after it, and paste the reply below"
					onclick={copyPrompt}>{copied ? 'Copied' : 'Copy LLM prompt'}</button
				>
			</div>
			<!-- any variable from layout.css or the --twp-* syntax ones, as declarations -->
			<textarea
				id="theme-css"
				class="h-40 w-full resize-y rounded-lg border border-line bg-surface p-3 font-mono text-[12px] leading-5 text-fg shadow-sunken outline-none placeholder:text-faint focus:border-muted"
				spellcheck="false"
				placeholder={'--fg: #ececec;\n--add-bg: #12261e;\n--twp-regex: #a5d6ff;'}
				value={css}
				oninput={(event) => editCss(event.currentTarget.value)}
				onblur={refresh}></textarea>
			<p class="text-[12px] text-faint">
				Want a theme like Kanagawa Dragon? Make a new theme, copy the prompt, give it to an LLM with
				the theme's name, and paste its reply here.
			</p>
		</div>

		<div class="flex flex-col gap-1.5">
			<label for="rules-field" class="text-[11px] font-medium tracking-wide text-faint uppercase"
				>CSS rules</label
			>
			<!-- whole rules for what no variable reaches, the scrollbars say, applied with the theme -->
			<textarea
				id="rules-field"
				class="h-32 w-full resize-y rounded-lg border border-line bg-surface p-3 font-mono text-[12px] leading-5 text-fg shadow-sunken outline-none placeholder:text-faint focus:border-muted"
				spellcheck="false"
				placeholder={'::selection {\n\tbackground: #ffc799;\n}'}
				value={rules}
				oninput={(event) => editRules(event.currentTarget.value)}></textarea>
			<p class="text-[12px] text-faint">
				Whole rules, for what the variables don't reach. They apply with this theme only.
			</p>
		</div>
	</div>
</main>
