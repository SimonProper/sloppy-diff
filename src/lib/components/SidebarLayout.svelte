<script module lang="ts">
	import type { Layout } from '$lib/diff/split';

	/** the right panel's width, saved under this key when dragged */
	export const PANEL_KEY = 'ask-panel-width';
	export const PANEL_DEFAULT = 440;

	// what surrounds the code in FileDiff: line number gutters, the left and right
	// padding, the slot for question markers and the card's border
	const CHROME: Record<Layout, number> = {
		unified: 96 + 12 + 32 + 14 + 2,
		split: 2 * (48 + 12 + 16 + 14) + 2
	};
	/** the diffs' column at its widest (see `.page-column`) */
	const COLUMN: Record<Layout, number> = { unified: 60 * 16, split: 120 * 16 };

	/**
	 * How wide the diffs need to be for lines of `chars` columns, per side when split, at
	 * `char` pixels a character. No wider than their column, more room than that goes
	 * beside it, not to their lines.
	 */
	export function diffWidth(layout: Layout, chars: number, char = 7.5) {
		return Math.min(char * chars * (layout === 'split' ? 2 : 1) + CHROME[layout], COLUMN[layout]);
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { typing } from '$lib/keys';
	import { readText, writeText } from '$lib/storage';
	import ResizeHandle, { storedSize } from './ResizeHandle.svelte';

	interface Props {
		/** combined height of the page header and shared view navigation, in pixels */
		stickyTop?: number;
		/** how diffs are shown, split needs room for two sides */
		layout: Layout;
		/** columns of code the diffs always have room for, per side when split */
		chars?: number;
		/** the sidebar, without one its column is gone */
		aside?: Snippet;
		/** where the sidebar's width is remembered, one per kind of sidebar */
		sizeKey?: string;
		/** its width until it's dragged */
		defaultWidth?: number;
		/**
		 * What the folded rail shows instead, a column small enough for its width: numbers,
		 * badges, dividers. Items with `data-tip` get a tooltip beside the rail.
		 */
		rail?: Snippet;
		children: Snippet;
		asideClass?: string;
		/** a column at the right beside the diffs, the question panel */
		panel?: Snippet;
		/** its width as dragged, null for the default */
		panelWidth?: number | null;
		/** closes the panel, for the sidebar kept open where there's no room for both */
		onpanelclose?: () => void;
	}

	let {
		stickyTop = 48,
		layout,
		chars = 100,
		aside,
		sizeKey = 'sidebar-width',
		defaultWidth = 272,
		rail: railContent,
		children,
		asideClass = '',
		panel: panelContent,
		panelWidth = $bindable(null),
		onpanelclose
	}: Props = $props();

	const MIN = 200;
	/** characters the font is measured over */
	const PROBE = 100;

	let total = $state(0);
	let rightPanel = $state<HTMLElement>();
	const PANEL_MIN = 360;
	/**
	 * The widest the right panel gets: the diffs keep room for their lines beside
	 * it, so dragging it wider stops there rather than the code scrolling. The sidebar
	 * narrows and then folds into its rail to make room, only the rail is kept, or
	 * kept open, its narrowest.
	 */
	const PANEL_MAX = $derived.by(() =>
		Math.max(PANEL_MIN, total - diffMin - (aside ? (keepOpen ? MIN : RAIL) : 0))
	);
	const panelSize = $derived(Math.min(Math.max(panelWidth ?? PANEL_DEFAULT, PANEL_MIN), PANEL_MAX));
	/** the right column, 0 while the panel is closed so opening it can ease */
	const right = $derived(panelContent ? panelSize : 0);
	/** what's left for the sidebar and the diffs */
	const room = $derived(total - right);
	// read again for another kind of sidebar, dragging sets it until then
	let stored = $derived<number | null>(storedSize(sizeKey));
	let panel = $state<HTMLElement>();
	let toggleButton = $state<HTMLButtonElement>();
	let probe: HTMLElement;
	/** width of a character of code, measured since it depends on the font */
	let char = $state(7.5);

	/** the diffs and the page's padding around them */
	const diffMin = $derived(diffWidth(layout, chars, char) + 32);
	/** no room for even the narrowest sidebar beside the diff */
	const narrow = $derived(total > 0 && room - diffMin < MIN);

	const DOCKED_KEY = 'sidebar-docked';
	/** kept beside the diffs when they're narrow, the question panel giving way to it */
	let docked = $state(readText(DOCKED_KEY) === 'true');

	// the diff's minimum wins over a wide sidebar, in a narrow window or when switching to
	// split. Only a window too small for both panels' narrowest takes from it
	const max = $derived(Math.max(MIN, room - diffMin));
	const width = $derived(Math.min(Math.max(stored ?? defaultWidth, MIN), max));

	/** the rail's width */
	const RAIL = 40;
	const FOLDED_KEY = 'sidebar-folded';
	/** folded into the rail by hand, where there's room for it */
	let folded = $state(readText(FOLDED_KEY) === 'true');

	// otherwise it folds into a rail, opening over the diffs at the width it would have had
	// the sidebar kept open and the panel are pinned, where there's no room for both at
	// their narrowest the one pinned last stays: opening the panel folds the sidebar for
	// as long as it's open, keeping the sidebar open closes the panel
	const crowded = $derived(total > 0 && total - diffMin - PANEL_MIN < MIN);
	const keepOpen = $derived(docked && !(panelContent && crowded));
	const rail = $derived(narrow ? !keepOpen : folded);
	const expanded = $derived(Math.min(Math.max(stored ?? defaultWidth, MIN), room - RAIL));

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

	/** docking or folding right now: the column and the panel ease to their new width */
	let moving = $state(false);
	let moveTimer: ReturnType<typeof setTimeout> | undefined;
	/** over the diffs rather than in its column, as a rail and while it moves */
	const floating = $derived(rail || moving);

	/** Keeps the sidebar in its column, or folds it into the rail. */
	function dock(next: boolean) {
		// narrow, it's kept open against the diff's width. With room, only folded by hand
		if (narrow) {
			docked = next;
			writeText(DOCKED_KEY, next ? 'true' : null);
			// kept open, it stays open once there's room again too, as when it closes the panel
			if (next) {
				folded = false;
				writeText(FOLDED_KEY, null);
			}
			if (next && panelContent && crowded) onpanelclose?.();
		} else {
			folded = !next;
			writeText(FOLDED_KEY, next ? null : 'true');
		}
		opened = false;
		// the transitions' length, then it settles into its column
		moving = true;
		clearTimeout(moveTimer);
		moveTimer = setTimeout(() => (moving = false), 220);
	}

	// s opens and closes the rail, Escape closes it
	function onkeydown(event: KeyboardEvent) {
		if (!rail || event.metaKey || event.ctrlKey || event.altKey) return;
		if (typing(event)) return;
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

	/** the right panel opening or closing, its column eases like the sidebar's */
	let panelMoving = $state(false);
	let panelTimer: ReturnType<typeof setTimeout> | undefined;
	let panelWasOpen: boolean | null = null;
	// before the DOM updates, so the transition is on when the column's width changes
	$effect.pre(() => {
		const isOpen = !!panelContent;
		if (panelWasOpen !== null && isOpen !== panelWasOpen) {
			panelMoving = true;
			clearTimeout(panelTimer);
			panelTimer = setTimeout(() => (panelMoving = false), 220);
		}
		panelWasOpen = isOpen;
	});

	$effect(() => () => (clearTimeout(tipTimer), clearTimeout(moveTimer), clearTimeout(panelTimer)));

	$effect(() => {
		const measure = () => (char = probe.getBoundingClientRect().width / PROBE || char);
		measure();
		// the code font may still be loading
		document.fonts?.ready.then(measure);
	});
</script>

<svelte:window {onkeydown} onpointerdowncapture={onpointerdown} />

<!-- resizing live is cheap, diffs off screen aren't laid out (see LazyBlock) -->
<div
	class={['columns relative grid', (moving || panelMoving) && 'moving-column']}
	style:--left="{aside ? (rail ? RAIL : width) : 0}px"
	style:--right="{right}px"
	bind:clientWidth={total}
>
	<!-- holds the sidebar's column, as a rail the sidebar floats over the diffs from here,
	     above their sticky headers and below the page's -->
	<div
		class={[
			'sticky',
			floating && 'z-[18]',
			// still a grid cell, so the diffs keep theirs
			!aside && 'invisible overflow-hidden'
		]}
		style:top="{stickyTop}px"
		style:height="calc(100dvh - {stickyTop}px)"
	>
		<!-- as a rail the panel stays laid out at its open width, hidden under the rail's
		     column, so opening only moves its edge and keeps its scroll and state. Docked in a
		     narrow window it has a width too, for folding to ease from -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
		<aside
			bind:this={panel}
			class={[
				'flex h-full flex-col border-r border-line bg-sidebar',
				floating && 'rail absolute inset-y-0 left-0 overflow-hidden',
				open && 'open shadow-float',
				moving && 'moving',
				instant && 'instant'
			]}
			style:width={rail ? `${open ? expanded : RAIL}px` : `${width}px`}
			{onclick}
			onpointerover={rail ? onpointerover : undefined}
			onpointerleave={rail ? hideTip : undefined}
			onscrollcapture={rail ? hideTip : undefined}
		>
			<div class="flex h-full min-h-0 flex-col" style:width={floating ? `${expanded}px` : null}>
				<div
					class="flex h-11 shrink-0 items-center justify-between border-b border-line pr-2 pl-1 shadow-strip"
				>
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
					{#if !collapsed}
						<button
							type="button"
							class="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted hover:bg-subtle hover:text-fg"
							title={rail
								? narrow
									? panelContent && crowded
										? 'Keep the sidebar open, closing the question panel'
										: 'Keep the sidebar open, long lines wrap'
									: 'Keep the sidebar open'
								: 'Fold into a rail'}
							onclick={() => dock(rail)}
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
								{#if !rail}
									<path d="m11 6-2 2 2 2" />
								{:else}
									<path d="M4 5v6" stroke-width="2.5" />
								{/if}
							</svg>
							{rail ? 'Keep open' : 'Fold'}
						</button>
					{/if}
				</div>
				<div class={['flex min-h-0 flex-1 flex-col', asideClass, collapsed && 'invisible']}>
					{@render aside?.()}
				</div>
			</div>
			{#if collapsed && railContent}
				<div
					class="absolute inset-x-0 top-11 bottom-0 flex [scrollbar-width:none] flex-col items-center gap-1.5 overflow-y-auto pt-1 pb-4"
				>
					{@render railContent()}
				</div>
			{/if}
		</aside>
	</div>
	{@render children()}

	<!-- the question panel, a column of the page like the sidebar, resized from its left edge.
	     Laid out at its full width, so opening only moves its edge and nothing in it reflows -->
	<div
		bind:this={rightPanel}
		class="sticky overflow-x-clip"
		style:top="{stickyTop}px"
		style:height="calc(100dvh - {stickyTop}px)"
	>
		<div class="relative flex h-full flex-col" style:width="{panelSize}px">
			{#if panelContent}
				<div class="absolute inset-y-0 left-0 w-px">
					<ResizeHandle
						bind:size={panelWidth}
						key={PANEL_KEY}
						panel={rightPanel}
						orientation="vertical"
						reverse
						label="Resize the question panel"
						min={PANEL_MIN}
						max={PANEL_MAX}
					/>
				</div>
				{@render panelContent()}
			{/if}
		</div>
	</div>

	{#if aside && !rail}
		<!-- over the sidebar's border, the length of the page so it can be grabbed anywhere -->
		<div class="absolute inset-y-0 w-px" style:left="{width - 1}px">
			<ResizeHandle
				bind:size={stored}
				key={sizeKey}
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
		>{'0'.repeat(PROBE)}</span
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
	/* registered so they ease, the diffs centre on the page with them (see FileDiff) */
	@property --left {
		syntax: '<length>';
		inherits: true;
		initial-value: 0px;
	}
	@property --right {
		syntax: '<length>';
		inherits: true;
		initial-value: 0px;
	}
	.columns {
		grid-template-columns: var(--left) minmax(0, 1fr) var(--right);
	}
	/* docking and folding: the column moves the diffs along with the panel's edge */
	.moving-column {
		transition:
			--left 200ms cubic-bezier(0.23, 1, 0.32, 1),
			--right 200ms cubic-bezier(0.23, 1, 0.32, 1);
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
