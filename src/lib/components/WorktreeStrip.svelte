<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { followWorktrees } from '$lib/agents/agents.remote';
	import {
		firstTabs,
		linkedPr,
		loudest,
		moveTab,
		ordered,
		reordered,
		signal,
		tabKeys,
		worktreeOfPr,
		type Place,
		type Tabs
	} from '$lib/agents/places';
	import type { SessionSummary, WorktreeStatus } from '$lib/agents/types';
	import { readTabs, saveTabs } from '$lib/agents/tabs.svelte';
	import { getPullRequests } from '$lib/pr/pr.remote';
	import { readJson, writeJson } from '$lib/storage';
	import Logo from './Logo.svelte';
	import Popover from './Popover.svelte';
	import RepoButton from './RepoButton.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	/**
	 * The title bar: the repo, its pull requests, and a tab for each worktree you have open, saying
	 * what its agent is doing, the main checkout's first. A pull request read without a worktree
	 * gets a tab too. Each tab goes back to where you last were in it. `fetch` as the page's own
	 * `followWorktrees`, so they share it.
	 */
	let { main, place, fetch = false }: { main: string; place: Place; fetch?: boolean } = $props();

	const live = $derived(followWorktrees({ repo: main, fetch }));
	const trees = $derived(live.current?.worktrees);
	const prsQuery = $derived(getPullRequests(main));
	const prs = $derived(prsQuery.error ? null : prsQuery.current);
	const label = (t: WorktreeStatus) => t.branch ?? `detached ${t.head.slice(0, 7)}`;
	const treeAt = (path: string) => trees?.find((t) => t.path === path);

	/** the tab on screen: `prs`, a worktree's path, or `#<number>` for a pull request's own */
	const here = $derived.by(() => {
		if (place.kind === 'prs') return 'prs';
		if (place.kind === 'tree') return place.path;
		// a pull request is only read in a worktree that has it checked out, else in the main checkout
		if (place.root !== main) return place.root;
		return worktreeOfPr(place.number, trees, prs)?.path === main ? main : `#${place.number}`;
	});

	// the tabs as kept, a first look's until then, and where you last were in each
	const lastKey = $derived(`worktree-tabs-last:${main}`);
	const saved = $derived(readTabs(main));
	const tabs = $derived(saved ?? (trees ? firstTabs(trees, prs) : null));
	const keys = $derived(tabs && trees ? tabKeys(tabs, trees, prs) : []);
	const save = (next: Tabs) => saveTabs(main, next);

	// the tab you're on is open, and remembers where you are in it
	let openedFor = '';
	$effect(() => {
		const url = page.url.pathname + page.url.search;
		const key = here;
		const last = readJson<Record<string, string>>(lastKey, {});
		if (last[key] !== url) writeJson(lastKey, { ...last, [key]: url });
		// once per page, a tab closed while on it isn't opened again before moving on
		if (!tabs || !trees || prs === undefined || openedFor === page.url.href) return;
		openedFor = page.url.href;
		const number = key.startsWith('#') ? Number(key.slice(1)) : null;
		if (number !== null && !tabs.prs.includes(number) && tabs.preview !== number) {
			save({ ...tabs, preview: number });
		} else if (tabs.closed.includes(key)) {
			save({ ...tabs, closed: tabs.closed.filter((p) => p !== key) });
		} else if (!saved) save(tabs);
	});

	/** Where a tab takes you: where you were in it, else a worktree's agents or its changes. */
	function hrefOf(key: string) {
		const last = readJson<Record<string, string>>(lastKey, {})[key];
		if (last) {
			const url = new URL(last, page.url);
			// not a new session's empty field again, nor a session closed since
			url.searchParams.delete('new');
			const id = url.searchParams.get('session');
			if (id && !treeAt(key)?.sessions.some((s) => s.id === id && s.open)) {
				url.searchParams.delete('session');
			}
			return url.pathname + url.search;
		}
		if (key === 'prs') return `/?${new URLSearchParams({ repo: main, pr: '' })}`;
		if (key.startsWith('#')) return `/?${new URLSearchParams({ repo: main, pr: key.slice(1) })}`;
		return treeAt(key)?.sessions.some((s) => s.open)
			? `/agents?${new URLSearchParams({ repo: main, cwd: key })}`
			: `/?${new URLSearchParams({ repo: key })}`;
	}

	function go(key: string) {
		choosing = false;
		if (key !== here) goto(hrefOf(key));
	}

	const closable = (key: string) => keys.includes(key) && key !== main;

	/** Closes the tab, the worktree stays. Closing the one you're on moves to the next. */
	function close(key: string) {
		if (!tabs || !closable(key)) return;
		const i = keys.indexOf(key);
		const next = keys[i + 1] ?? keys[i - 1] ?? 'prs';
		const n = Number(key.slice(1));
		save(
			key.startsWith('#')
				? {
						...tabs,
						prs: tabs.prs.filter((m) => m !== n),
						preview: tabs.preview === n ? null : tabs.preview
					}
				: { ...tabs, closed: [...tabs.closed, key] }
		);
		if (key === here) go(next);
	}

	/** Keeps the preview, the next pull request opened gets a tab of its own. */
	function keep(number: number) {
		if (tabs?.preview === number) save({ ...tabs, prs: [...tabs.prs, number], preview: null });
	}

	// ⌘W, from the app's menu: the tab you're on, false when it can't be closed
	$effect(() => {
		const app = window as { closeTab?: () => boolean };
		app.closeTab = () => {
			if (!closable(here)) return false;
			close(here);
			return true;
		};
		return () => delete app.closeTab;
	});

	/** the tab being dragged, the others slide aside for it meanwhile */
	let dragging = $state<string | null>(null);
	/** the slide of the others, and of the dragged tab into its place when let go */
	const SLIDE_MS = 150;
	/** the dragged tab above the others, they slide as it passes */
	const slides = (key: string) =>
		dragging && (dragging === key ? 'relative z-10' : 'transition-transform duration-150 ease-out');

	/**
	 * A tab dragged as a browser's are, not dragged and dropped: it follows the pointer along the
	 * strip, the others slide aside as it passes their middles, and let go it settles into the gap.
	 * Worktrees among worktrees, pull requests among their own. A press that doesn't move is a click.
	 */
	function drag(key: string) {
		return (el: HTMLElement) => {
			const down = (event: PointerEvent) => {
				if (event.button !== 0 || !nav || (event.target as Element).closest('[data-closer]')) {
					return;
				}
				const group = keys.filter((k) => k !== main && k.startsWith('#') === key.startsWith('#'));
				const els = group.map((k) =>
					nav!.querySelector<HTMLElement>(`[data-tab="${CSS.escape(k)}"]`)!
				);
				const boxes = els.map((e) => e.getBoundingClientRect());
				const from = group.indexOf(key);
				const own = boxes[from];
				// what a tab moves by to make room: the dragged one's width and the gap after it
				const room = own.width + (boxes.length > 1 ? boxes[1].left - boxes[0].right : 0);
				const startX = event.clientX;
				let to = from;
				let moved = false;

				const move = (e: PointerEvent) => {
					const pulled = e.clientX - startX;
					if (!moved) {
						if (Math.abs(pulled) < 4) return;
						moved = true;
						dragging = key;
						// held from here on, so the press's click goes to the tab, not its button
						el.setPointerCapture(e.pointerId);
					}
					// along the strip, not past its first and last tabs
					const dx = Math.min(
						Math.max(pulled, boxes[0].left - own.left),
						boxes.at(-1)!.right - own.right
					);
					el.style.transform = `translateX(${dx}px)`;
					const middle = own.left + own.width / 2 + dx;
					to = boxes.filter((b, i) => i !== from && b.left + b.width / 2 < middle).length;
					els.forEach((other, i) => {
						if (i === from) return;
						const shift =
							from < to && i > from && i <= to
								? -room
								: to < from && i >= to && i < from
									? room
									: 0;
						other.style.transform = shift ? `translateX(${shift}px)` : '';
					});
				};

				const up = () => {
					removeEventListener('pointermove', move);
					removeEventListener('pointerup', up);
					removeEventListener('pointercancel', up);
					if (!moved) return;
					// into the gap the others left it, then kept in that order and the slides undone
					// at once, so nothing moves as the tabs are drawn again in their new order
					el.style.transition = `transform ${SLIDE_MS}ms ease-out`;
					el.style.transform = `translateX(${
						to > from ? boxes[to].right - own.right : boxes[to].left - own.left
					}px)`;
					setTimeout(async () => {
						const next = moveTab(keys, key, group[to]);
						if (tabs && next !== keys) save(reordered(tabs, next));
						await tick();
						for (const e of els) {
							e.style.transition = 'none';
							e.style.transform = '';
						}
						dragging = null;
						requestAnimationFrame(() => els.forEach((e) => (e.style.transition = '')));
					}, SLIDE_MS);
				};

				addEventListener('pointermove', move);
				addEventListener('pointerup', up);
				addEventListener('pointercancel', up);
			};
			el.addEventListener('pointerdown', down);
			return () => el.removeEventListener('pointerdown', down);
		};
	}

	/** ⌘1 to ⌘8 go to a tab, ⌘9 to the last, as in a browser */
	function onkeydown(event: KeyboardEvent) {
		if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
		const n = Number(event.key);
		if (!Number.isInteger(n) || n < 1 || !keys.length) return;
		const key = n === 9 ? keys.at(-1) : keys[n - 1];
		if (!key) return;
		event.preventDefault();
		go(key);
	}
	const shortcut = (key: string) => {
		const i = keys.indexOf(key);
		return i === keys.length - 1 ? '  ⌘9' : i < 8 ? `  ⌘${i + 1}` : '';
	};

	// the tab you're on stays in sight when they don't all fit
	let nav = $state<HTMLElement>();
	$effect(() => {
		void keys.length;
		nav
			?.querySelector(`[data-tab="${CSS.escape(here)}"]`)
			?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	});

	let choosing = $state(false);
	/** the worktrees without a tab, and what their agents are up to, counted on the selector */
	const others = $derived((trees ?? []).filter((t) => !keys.includes(t.path)));
	const unseen = $derived(others.map((t) => loudest(t.sessions)).filter((s) => !!s));
	const needing = $derived(unseen.filter((s) => s.waiting).length);
	const done = $derived(unseen.filter((s) => !s.waiting && s.unread).length);

	const pill = (on: boolean, tab = false) => [
		'flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] whitespace-nowrap',
		// tabs give way before they scroll
		// dragged by, their text isn't selected
		tab ? 'min-w-20 shrink select-none' : 'shrink-0',
		on
			? 'border-line bg-surface text-fg shadow-raised'
			: 'border-transparent text-muted hover:bg-subtle hover:text-fg'
	];
</script>

<svelte:window {onkeydown} />

{#snippet status(s: SessionSummary | null)}
	{#if s}
		{@const st = signal(s)}
		{#if st.glyph === 'check'}
			<svg
				viewBox="0 0 16 16"
				class={['size-3 shrink-0', st.class]}
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg
			>
		{:else}
			<span class={['size-1.5 shrink-0 rounded-full', st.class]} aria-hidden="true"></span>
		{/if}
		<span class="sr-only">{st.title}:</span>
	{/if}
{/snippet}

<!-- on the tab you're on, on the others while hovered -->
{#snippet closer(key: string, name: string)}
	<button
		type="button"
		data-closer
		class={[
			'-mr-1.5 grid size-5 shrink-0 place-items-center rounded-full text-faint hover:bg-subtle hover:text-fg',
			key !== here && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
		]}
		aria-label="Close the tab of {name}"
		title="Close the tab, the worktree stays  ⌘W"
		onclick={() => close(key)}
		><svg
			viewBox="0 0 16 16"
			class="size-2.5"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg
		></button
	>
{/snippet}

<div
	class="title-bar flex h-12 items-center gap-1 border-b border-line px-3 shadow-strip min-[1351px]:px-4"
>
	<Logo />
	<RepoButton repo={main} />
	<span class="mx-1.5 h-5 w-px shrink-0 bg-line"></span>
	<button
		type="button"
		class={pill(here === 'prs')}
		aria-current={here === 'prs' ? 'page' : undefined}
		onclick={() => go('prs')}
	>
		Pull requests
		{#if prs?.length}<span class="text-faint tabular-nums">{prs.length}</span>{/if}
	</button>
	<span class="mx-1.5 h-5 w-px shrink-0 bg-line"></span>

	<!-- a wheel scrolls them sideways when they don't fit -->
	<nav
		bind:this={nav}
		aria-label="Worktrees"
		class="flex min-w-0 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto"
		onwheel={(event) => {
			if (!event.deltaX && nav) nav.scrollLeft += event.deltaY;
		}}
	>
		{#each keys as key (key)}
			{@const on = key === here}
			{#if key.startsWith('#')}
				{@const number = Number(key.slice(1))}
				{@const pr = prs?.find((p) => p.number === number)}
				{@const preview = tabs?.preview === number}
				<!-- dashed, nothing to run in it: no worktree behind it. The preview in italics, the
				     next pull request opened takes its place until it's kept -->
				<div
					data-tab={key}
					class={[pill(on, true), 'group border-dashed', !on && 'border-faint/60', slides(key)]}
					{@attach drag(key)}
				>
					<button
						type="button"
						class={['flex min-w-0 items-center gap-1.5', preview && 'italic']}
						aria-current={on ? 'page' : undefined}
						title="{pr ? `#${number} ${pr.title}` : `#${number}`}, not checked out{preview
							? '. Double-click to keep the tab'
							: ''}{shortcut(key)}"
						onclick={() => go(key)}
						ondblclick={() => keep(number)}
					>
						<span class="shrink-0 font-mono text-[11.5px] text-faint">#{number}</span>
						{#if pr}<span class="max-w-40 min-w-0 truncate">{pr.title}</span>{/if}
					</button>
					{@render closer(key, `#${number}`)}
				</div>
			{:else}
				{@const tree = treeAt(key)}
				{@const loud = tree ? loudest(tree.sessions) : null}
				{@const linked = tree ? linkedPr(tree, prs) : null}
				{@const name = tree ? label(tree) : key.split('/').pop()}
				{#if key === main}
					<!-- the main checkout's, always first and always there -->
					<div data-tab={key} class={pill(on, true)}>
						<button
							type="button"
							class="flex min-w-0 items-center gap-1.5"
							aria-current={on ? 'page' : undefined}
							title="{key}, the main checkout{shortcut(key)}"
							onclick={() => go(key)}
						>
							{@render status(loud)}
							<span class="min-w-0 truncate font-mono text-[12px]">{name}</span>
						</button>
					</div>
				{:else}
					<div data-tab={key} class={[pill(on, true), 'group', slides(key)]} {@attach drag(key)}>
						<button
							type="button"
							class={[
								'flex min-w-0 items-center gap-1.5',
								loud && (loud.unread || loud.waiting) && !on && 'font-medium text-fg'
							]}
							aria-current={on ? 'page' : undefined}
							title="{key}{shortcut(key)}"
							onclick={() => go(key)}
						>
							{@render status(loud)}
							<span class="max-w-44 min-w-0 truncate font-mono text-[12px]">{name}</span>
							{#if linked}<span class="shrink-0 font-mono text-[11px] text-faint"
									>#{linked.number}</span
								>{/if}
							{#if tree?.added || tree?.removed}
								<span class="shrink-0 font-mono text-[10.5px] text-faint tabular-nums"
									>+{tree.added} −{tree.removed}</span
								>
							{/if}
						</button>
						{@render closer(key, name ?? key)}
					</div>
				{/if}
			{/if}
		{/each}
	</nav>

	<Popover
		bind:open={choosing}
		class="w-[26rem] rounded-2xl border border-line bg-surface p-1 shadow-float"
	>
		{#snippet trigger(props)}
			<button
				{...props}
				class={[
					'flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-muted hover:bg-subtle hover:text-fg',
					choosing && 'bg-subtle text-fg'
				]}
				title="All worktrees"
				aria-label="All worktrees{needing ? `, ${needing} without a tab need you` : ''}"
			>
				<svg
					viewBox="0 0 16 16"
					class="size-3.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="m4 6 4 4 4-4" /></svg
				>
				{#if needing || done}
					<span
						class={[
							'grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-medium text-surface tabular-nums',
							needing ? 'bg-mod' : 'bg-muted'
						]}
						title={needing
							? `${needing} without a tab need you`
							: `${done} without a tab done, not looked at yet`}>{needing || done}</span
					>
				{/if}
			</button>
		{/snippet}

		{#each [true, false] as opened (opened)}
			<!-- the open ones in their tabs' order, the others after as the sidebar has them -->
			{@const list = opened
				? keys.flatMap((key) => treeAt(key) ?? [])
				: ordered(others, tabs?.order ?? [])}
			{#if list.length}
				<p class="px-3 pt-2 pb-1 text-[10.5px] font-medium tracking-wide text-faint uppercase">
					{opened ? 'Open' : 'Not in a tab'}
				</p>
				{#each list as t (t.path)}
					{@const loud = loudest(t.sessions)}
					{@const linked = linkedPr(t, prs)}
					<button
						type="button"
						class={[
							'flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[12.5px] hover:bg-subtle',
							t.path === here && 'bg-subtle'
						]}
						title={t.path}
						onclick={() => go(t.path)}
					>
						<span class="grid size-3 shrink-0 place-items-center">{@render status(loud)}</span>
						<span class="min-w-0 flex-1">
							<span class="flex items-center gap-1.5">
								<span class="truncate font-mono text-[12px]">{label(t)}</span>
								{#if linked}<span class="font-mono text-[11px] text-faint">#{linked.number}</span
									>{/if}
							</span>
							{#if loud || linked}
								<span class="block truncate text-[11px] text-muted"
									>{loud
										? `${loud.title} · ${signal(loud).title.toLowerCase()}`
										: linked?.title}</span
								>
							{/if}
						</span>
						<span class="flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-muted">
							{#if t.ahead}<span>↑{t.ahead}</span>{/if}
							{#if t.behind}<span>↓{t.behind}</span>{/if}
							{#if t.added || t.removed}<span class="tabular-nums">+{t.added} −{t.removed}</span
								>{/if}
						</span>
					</button>
				{/each}
			{/if}
		{/each}
		<div class="mt-1 flex gap-1 border-t border-line p-1 pt-2">
			<a
				class="flex h-7 items-center rounded-full px-3 text-[12px] text-muted hover:bg-subtle hover:text-fg"
				href="/agents?{new URLSearchParams({ repo: main, new: '' })}"
				onclick={() => (choosing = false)}>New worktree</a
			>
			<button
				type="button"
				class="flex h-7 items-center rounded-full px-3 text-[12px] text-muted hover:bg-subtle hover:text-fg"
				onclick={() => go('prs')}>Pull requests</button
			>
		</div>
	</Popover>

	<!-- room to drag the window by, however many tabs there are -->
	<span class="min-w-10 flex-1"></span>
	<ThemeToggle />
</div>
