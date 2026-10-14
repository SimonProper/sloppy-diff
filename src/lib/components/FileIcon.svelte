<script lang="ts">
	/**
	 * A file's type, as a mark in a square. Drawn in the text colour like the rest of the
	 * chrome, hues on screen are for the diff.
	 */
	let { path }: { path: string } = $props();

	const MARKS: [RegExp, string][] = [
		[/\.[cm]?tsx?$/, 'TS'],
		[/\.[cm]?jsx?$/, 'JS'],
		[/\.svelte$/, 'S'],
		[/\.(h|hh|hpp|hxx)$/, 'H'],
		[/\.(cc|cpp|cxx)$/, 'C+'],
		[/\.c$/, 'C'],
		[/\.mm?$/, 'M'],
		[/\.json$/, '{}'],
		[/\.md$/, 'MD'],
		[/\.(css|scss)$/, '#'],
		[/\.html$/, '<>'],
		[/\.py$/, 'PY'],
		[/\.rs$/, 'RS'],
		[/\.go$/, 'GO'],
		[/\.(sh|zsh|bash)$/, '$']
	];

	const mark = $derived(MARKS.find(([pattern]) => pattern.test(path.toLowerCase()))?.[1]);
</script>

<svg viewBox="0 0 14 14" class="size-3.5 shrink-0" aria-hidden="true">
	{#if mark}
		<rect width="14" height="14" rx="3" fill="currentColor" opacity="0.14" />
		<text
			x="7"
			y="7.4"
			text-anchor="middle"
			dominant-baseline="middle"
			fill="currentColor"
			font-family="var(--font-sans)"
			font-size={mark.length > 1 ? 6.5 : 8}
			font-weight="700">{mark}</text
		>
	{:else}
		<!-- any other file: a page with its corner folded -->
		<path
			d="M3.5 1.5h4.5L10.5 4v8.5h-7zM8 1.5V4h2.5"
			fill="none"
			stroke="currentColor"
			stroke-width="1.2"
			stroke-linejoin="round"
		/>
	{/if}
</svg>
