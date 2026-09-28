<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Layout } from '$lib/diff/split';
	import ResizeHandle from './ResizeHandle.svelte';

	interface Props {
		/** how diffs are shown, split needs room for two sides */
		layout: Layout;
		aside: Snippet;
		children: Snippet;
		asideClass?: string;
	}

	let { layout, aside, children, asideClass = '' }: Props = $props();

	const KEY = 'sidebar-width';
	const MIN = 200;
	const DEFAULT = 272;
	/** characters of code a diff always has room for, per side when split */
	const CHARS = 80;
	// what surrounds the code in FileDiff: line number gutters, the +/− marker and
	// right padding, the card's border, and the page's padding around the cards
	const CHROME: Record<Layout, number> = {
		unified: 96 + 20 + 32 + 2 + 32,
		split: 2 * (48 + 20 + 16) + 2 + 32
	};

	let total = $state(0);
	let dragging = $state(false);
	let stored = $state<number | null>(read());
	let panel = $state<HTMLElement>();
	let probe: HTMLElement;
	/** width of a character of code, measured since it depends on the font */
	let char = $state(7.5);

	const diffMin = $derived(char * CHARS * (layout === 'split' ? 2 : 1) + CHROME[layout]);
	// the diff's minimum wins over a wide sidebar, in a narrow window or when switching to split
	const max = $derived(Math.max(MIN, total - diffMin));
	const width = $derived(Math.min(Math.max(stored ?? DEFAULT, MIN), max));

	$effect(() => {
		const measure = () => (char = probe.getBoundingClientRect().width / CHARS || char);
		measure();
		// the code font may still be loading
		document.fonts?.ready.then(measure);
	});

	function read(): number | null {
		try {
			const value = Number(localStorage.getItem(KEY));
			return value > 0 ? value : null;
		} catch {
			return null;
		}
	}

	$effect(() => {
		// saved once a drag ends, not on every move
		if (dragging) return;
		try {
			if (stored === null) localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, String(stored));
		} catch {
			// private windows and blocked storage just don't remember it
		}
	});
</script>

<!-- resizing live is cheap, diffs off screen aren't laid out (see LazyBlock) -->
<div
	class="relative grid"
	style:grid-template-columns="{width}px minmax(0, 1fr)"
	bind:clientWidth={total}
>
	<aside
		bind:this={panel}
		class={['sticky top-12 flex h-[calc(100vh-3rem)] flex-col border-r border-line', asideClass]}
	>
		{@render aside()}
	</aside>
	{@render children()}

	<!-- over the sidebar's border, the length of the page so it can be grabbed anywhere -->
	<div class="absolute inset-y-0 w-px" style:left="{width - 1}px">
		<ResizeHandle
			bind:size={stored}
			bind:dragging
			{panel}
			orientation="vertical"
			label="Resize the sidebar"
			min={MIN}
			{max}
		/>
	</div>

	<span
		bind:this={probe}
		aria-hidden="true"
		class="pointer-events-none invisible absolute font-mono text-[12.5px] whitespace-pre"
		>{'0'.repeat(CHARS)}</span
	>
</div>
