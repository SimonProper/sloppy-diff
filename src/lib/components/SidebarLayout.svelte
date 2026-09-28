<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Layout } from '$lib/diff/split';
	import ResizeHandle from './ResizeHandle.svelte';

	interface Props {
		/** how diffs are shown, split needs room for two sides */
		layout: Layout;
		aside: Snippet;
		/**
		 * What the folded rail shows instead, a column small enough for its width: numbers,
		 * badges, dividers. Items with `data-tip` get a tooltip beside the rail.
		 */
		rail?: Snippet;
		children: Snippet;
		asideClass?: string;
	}

	let { layout, aside, rail: railContent, children, asideClass = '' }: Props = $props();

	const KEY = 'sidebar-width';
	const MIN = 200;
	const DEFAULT = 272;
	/** characters of code a diff always has room for, per side when split */
	const CHARS = 80;
	// what surrounds the code in FileDiff: line number gutters, the +/− marker, right
	// padding and the slot for question markers, the card's border, and the page's
	// padding around the cards
	const CHROME: Record<Layout, number> = {
		unified: 96 + 20 + 32 + 14 + 2 + 32,
		split: 2 * (48 + 20 + 16 + 14) + 2 + 32
	};

	let total = $state(0);
	let dragging = $state(false);
	let stored = $state<number | null>(read());
	let panel = $state<HTMLElement>();
	let toggleButton = $state<HTMLButtonElement>();
	let probe: HTMLElement;
	/** width of a character of code, measured since it depends on the font */
	let char = $state(7.5);

	const diffMin = $derived(char * CHARS * (layout === 'split' ? 2 : 1) + CHROME[layout]);
	/** no room for even the narrowest sidebar beside the diff */
	const narrow = $derived(total > 0 && total - diffMin < MIN);

	const DOCKED_KEY = 'sidebar-docked';
	/** kept beside the diffs when they're narrow, their long lines wrapping instead */
	let docked = $state(readDocked());

	// the diff's minimum wins over a wide sidebar, in a narrow window or when switching to
	// split. Docked, lines wrap anyway, so the diff only keeps three quarters of it
	const max = $derived(Math.max(MIN, total - (narrow && docked ? diffMin * 0.75 : diffMin)));
	const width = $derived(Math.min(Math.max(stored ?? DEFAULT, MIN), max));

	/** the rail's width */
	const RAIL = 40;
	// otherwise it folds into a rail, opening over the diffs at the width it would have had
	const rail = $derived(narrow && !docked);
	const expanded = $derived(Math.min(Math.max(stored ?? DEFAULT, MIN), total - RAIL));

	let opened = $state(false);
	const open = $derived(rail && opened);
	const collapsed = $derived(rail && !open);
	/** opened or closed from the keyboard, which doesn't animate */
	let instant = $state(false);

	function setOpen(next: boolean, fromKeyboard = false) {
		if (next === open) return;
		tip = null;
		if (fromKeyboard) {
			instant = true;
			requestAnimationFrame(() => requestAnimationFrame(() => (instant = false)));
		}
		opened = next;
		// focus left inside the clipped part would be out of sight
		if (!next && panel?.contains(document.activeElement)) toggleButton?.focus();
	}

	function readDocked(): boolean {
		try {
			return localStorage.getItem(DOCKED_KEY) === 'true';
		} catch {
			return false;
		}
	}

	/** docking or folding right now: the column and the panel ease to their new width */
	let moving = $state(false);
	let moveTimer: ReturnType<typeof setTimeout> | undefined;
	/** over the diffs rather than in its column, as a rail and while it moves */
	const floating = $derived(rail || moving);

	function dock(next: boolean) {
		docked = next;
		opened = false;
		if (narrow) {
			// the transitions' length, then it settles into its column
			moving = true;
			clearTimeout(moveTimer);
			moveTimer = setTimeout(() => (moving = false), 220);
		}
		try {
			if (next) localStorage.setItem(DOCKED_KEY, 'true');
			else localStorage.removeItem(DOCKED_KEY);
		} catch {
			// private windows and blocked storage just don't remember it
		}
	}

	// s opens and closes the rail, Escape closes it
	function onkeydown(event: KeyboardEvent) {
		if (!rail || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement;
		if (target.closest('input, textarea, [contenteditable], dialog')) return;
		if (event.key === 's') setOpen(!open, true);
		else if (event.key === 'Escape' && open) setOpen(false, true);
	}

	// a press on the diffs closes the panel and does nothing else, a line picked or a
	// link followed by the same press would be a surprise
	function onpointerdown(event: PointerEvent) {
		if (!open || panel?.contains(event.target as Node)) return;
		event.preventDefault();
		event.stopPropagation();
		setOpen(false);
		const swallow = (e: MouseEvent) => (e.preventDefault(), e.stopPropagation());
		window.addEventListener('click', swallow, { capture: true, once: true });
		// a press that ends in no click, a drag, mustn't leave the next click swallowed
		window.addEventListener(
			'pointerdown',
			() => window.removeEventListener('click', swallow, { capture: true }),
			{ capture: true, once: true }
		);
	}

	// jumping to a file or step shows it, the panel over it shouldn't stay in the way
	function onclick(event: MouseEvent) {
		if (open && (event.target as Element).closest('a[href^="#"]')) setOpen(false);
	}

	/** the tooltip beside the rail, for the item under the pointer */
	let tip = $state<{ text: string; top: number } | null>(null);
	let tipTimer: ReturnType<typeof setTimeout> | undefined;
	/** when a tooltip last hid, moving on to the next item shows its tooltip at once */
	let tipHidden = 0;

	function onpointerover(event: PointerEvent) {
		if (!collapsed || event.pointerType === 'touch') return;
		const item = (event.target as Element).closest<HTMLElement>('[data-tip]');
		clearTimeout(tipTimer);
		if (!item?.dataset.tip) return hideTip();
		const show = () => {
			const rect = item.getBoundingClientRect();
			tip = { text: item.dataset.tip!, top: rect.top + rect.height / 2 };
		};
		if (tip || performance.now() - tipHidden < 300) show();
		else tipTimer = setTimeout(show, 400);
	}

	function hideTip() {
		clearTimeout(tipTimer);
		if (tip) tipHidden = performance.now();
		tip = null;
	}

	$effect(() => () => (clearTimeout(tipTimer), clearTimeout(moveTimer)));

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

<svelte:window {onkeydown} onpointerdowncapture={onpointerdown} />

<!-- resizing live is cheap, diffs off screen aren't laid out (see LazyBlock) -->
<div
	class={['relative grid', moving && 'moving-column']}
	style:grid-template-columns="{rail ? RAIL : width}px minmax(0, 1fr)"
	bind:clientWidth={total}
>
	<!-- holds the sidebar's column, as a rail the sidebar floats over the diffs from here,
	     above their sticky headers and below the page's -->
	<div class={['sticky top-12 h-[calc(100vh-3rem)]', floating && 'z-[18]']}>
		<!-- as a rail the panel stays laid out at its open width, hidden under the rail's
		     column, so opening only moves its edge and keeps its scroll and state. Docked in a
		     narrow window it has a width too, for folding to ease from -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
		<aside
			bind:this={panel}
			class={[
				'flex h-full flex-col border-r border-line',
				floating && 'rail absolute inset-y-0 left-0 overflow-hidden bg-canvas',
				open && 'open shadow-float',
				moving && 'moving',
				instant && 'instant'
			]}
			style:width={rail ? `${open ? expanded : RAIL}px` : narrow ? `${width}px` : null}
			{onclick}
			onpointerover={rail ? onpointerover : undefined}
			onpointerleave={rail ? hideTip : undefined}
			onscrollcapture={rail ? hideTip : undefined}
		>
			<div class="flex h-full min-h-0 flex-col" style:width={floating ? `${expanded}px` : null}>
				{#if narrow}
					<div class="flex h-10 shrink-0 items-center justify-between pr-2 pl-1">
						{#if rail}
							<button
								bind:this={toggleButton}
								type="button"
								class="grid size-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
								aria-label={open ? 'Close the sidebar' : 'Open the sidebar'}
								aria-expanded={open}
								aria-keyshortcuts="s"
								data-tip="Open the sidebar · S"
								onclick={() => setOpen(!open)}
							>
								<svg
									viewBox="0 0 16 16"
									class="size-4"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
									><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6 2.5v11" /></svg
								>
							</button>
						{:else}
							<span></span>
						{/if}
						{#if open || docked}
							<button
								type="button"
								class="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted hover:bg-subtle hover:text-fg"
								title={docked
									? 'Fold into a rail, long lines keep their width'
									: 'Keep the sidebar open, long lines wrap'}
								onclick={() => dock(!docked)}
							>
								<!-- the sidebar icon: its column filled to keep it, a chevron to fold it -->
								<svg
									viewBox="0 0 16 16"
									class="size-3.5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<rect x="2" y="2.5" width="12" height="11" rx="2" />
									<path d="M6 2.5v11" />
									{#if docked}
										<path d="m11 6-2 2 2 2" />
									{:else}
										<path d="M4 5v6" stroke-width="2.5" />
									{/if}
								</svg>
								{docked ? 'Fold' : 'Keep open'}
							</button>
						{/if}
					</div>
				{/if}
				<div class={['flex min-h-0 flex-1 flex-col', asideClass, collapsed && 'invisible']}>
					{@render aside()}
				</div>
			</div>
			{#if collapsed && railContent}
				<div
					class="absolute inset-x-0 top-10 bottom-0 flex [scrollbar-width:none] flex-col items-center gap-1.5 overflow-y-auto pt-1 pb-4"
				>
					{@render railContent()}
				</div>
			{/if}
		</aside>
	</div>
	{@render children()}

	{#if !rail}
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
	{/if}

	{#if tip}
		<div
			class="pointer-events-none fixed z-[19] max-w-80 -translate-y-1/2 truncate rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] text-fg shadow-float"
			style:left="{RAIL + 6}px"
			style:top="{tip.top}px"
			role="tooltip"
		>
			{tip.text}
		</div>
	{/if}

	<span
		bind:this={probe}
		aria-hidden="true"
		class="pointer-events-none invisible absolute font-mono text-[12.5px] whitespace-pre"
		>{'0'.repeat(CHARS)}</span
	>
</div>

<style>
	/* only the edge moves, opening a little slower than closing */
	.rail {
		transition:
			width 140ms cubic-bezier(0.23, 1, 0.32, 1),
			box-shadow 150ms ease;
	}
	.rail.open {
		transition-duration: 200ms, 150ms;
	}
	.rail.instant {
		transition: none;
	}
	/* docking and folding: the column moves the diffs along with the panel's edge */
	.moving-column {
		transition: grid-template-columns 200ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.rail.moving {
		transition-duration: 200ms, 150ms;
	}
	@media (prefers-reduced-motion: reduce) {
		.rail,
		.moving-column {
			transition: box-shadow 150ms ease;
		}
	}
</style>
