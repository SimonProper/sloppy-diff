<script lang="ts">
	import { goto, preloadData } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import { slowNavigation } from '$lib/slow.svelte';
	import { scrollSpy } from '$lib/scroll-spy.svelte';
	import { remember } from '$lib/prefs';
	import { typing } from '$lib/keys';
	import { sameSha } from '$lib/refs';
	import { repoName } from '$lib/repos';
	import { Threads } from '$lib/ask/threads.svelte';
	import AskLayer from '$lib/components/ask/AskLayer.svelte';
	import ChangesToolbar from '$lib/components/ChangesToolbar.svelte';
	import CommitCard from '$lib/components/CommitCard.svelte';
	import CommitList from '$lib/components/CommitList.svelte';
	import FileDiff from '$lib/components/FileDiff.svelte';
	import FileList from '$lib/components/FileList.svelte';
	import GuideDialog from '$lib/components/GuideDialog.svelte';
	import GuideView from '$lib/components/GuideView.svelte';
	import RefPicker from '$lib/components/RefPicker.svelte';
	import RepoButton from '$lib/components/RepoButton.svelte';
	import RepoList from '$lib/components/RepoList.svelte';
	import ResizeHandle from '$lib/components/ResizeHandle.svelte';
	import SidebarLayout from '$lib/components/SidebarLayout.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { displayPath } from '$lib/diff/path';
	import { lineStats } from '$lib/diff/hunks';
	import SavedGuides from '$lib/components/SavedGuides.svelte';

	let { data } = $props();

	const totals = $derived(lineStats(data.files.flatMap((f) => f.hunks)));
	// below this many lines everything renders, so the browser's find sees all of it.
	// Beyond, only lines near the viewport exist
	const VIRTUALIZE_LINES = 4000;
	const virtualize = $derived(totals.lines > VIRTUALIZE_LINES);
	// the file on screen, for the sidebar. The guide follows its own steps
	const reading = scrollSpy(() => (data.view === 'guide' ? [] : data.files.map((f) => f.id)));
	const headLabel = $derived(
		data.branch && data.branch !== 'HEAD' ? `HEAD · ${data.branch}` : 'HEAD'
	);
	const range = $derived(data.selection?.range ?? null);
	const branchSel = $derived(data.selection?.branch ?? null);
	const commit = $derived(data.selection?.commit ?? null);

	const lane = $derived(data.lane);
	/** the lane's commits oldest first, what came before it included */
	const sequence = $derived(lane ? [...lane.earlier].reverse().concat(lane.commits) : []);
	const at = $derived(commit ? sequence.findIndex((c) => sameSha(c.sha, commit.sha)) : -1);
	/** where the commit sits among the branch's own, 1-based, null when it's earlier */
	const position = $derived.by(() => {
		if (!lane || at < 0) return null;
		const own = at - lane.earlier.length;
		return own >= 0 ? { index: own + 1, total: lane.commits.length } : null;
	});

	// stepping through history one commit at a time, along the lane when there
	// is one. Without, older follows the first parent and newer is the newest
	// known commit whose first parent this is
	const older = $derived(at > 0 ? sequence[at - 1].sha : (commit?.parents[0] ?? null));
	const newer = $derived.by(() => {
		if (!commit) return null;
		if (at >= 0) return sequence[at + 1]?.sha ?? null;
		const child = (c: { parents: string[] }) => c.parents[0] && sameSha(c.parents[0], commit.sha);
		// past the listed commits of a lane, only a way back onto that lane, never onto
		// whichever other branch happened to commit on top of this one last
		if (lane) return sequence.find(child)?.sha ?? null;
		return data.commits.find(child)?.sha ?? null;
	});

	/** position of the narrowed span within the branch, 1-based */
	const span = $derived.by(() => {
		if (!branchSel?.first || !branchSel.last) return null;
		const first = branchSel.commits.findIndex((c) => c.sha === branchSel.first) + 1;
		const last = branchSel.commits.findIndex((c) => c.sha === branchSel.last) + 1;
		return { first, last, total: branchSel.commits.length };
	});

	let dialogOpen = $state(false);

	// questions to Claude about lines of the diff on screen. A range is named by the
	// shas the page resolved, so the server files them where the page load found them
	const threads = new Threads(() => ({
		repo: data.repo,
		from: data.selection?.range?.from ?? data.selection?.from ?? '',
		to: data.selection?.range?.to ?? '',
		scope: data.scope ?? 'worktree',
		threads: data.threads
	}));
	const asking = $derived(data.scope !== null && data.selection !== null ? threads : undefined);

	// answers still being written when the page loaded carry on streaming
	$effect(() => {
		if (asking) threads.resume();
	});

	// lines picked in a diff that's no longer on screen can't be asked about
	$effect(() => {
		const hunk = threads.draft?.span.hunk;
		if (hunk && !data.files.some((f) => f.hunks.some((h) => h.id === hunk))) threads.draft = null;
	});

	// the split between commits and files in the sidebar, kept in this browser only
	const SPLIT_KEY = 'sidebar-commits-height';
	let commitsPanel = $state<HTMLElement>();
	let commitsHeight = $state<number | null>(readSplit());

	function readSplit(): number | null {
		try {
			const value = Number(localStorage.getItem(SPLIT_KEY));
			return value > 0 ? value : null;
		} catch {
			return null;
		}
	}

	let splitDragging = $state(false);

	$effect(() => {
		// saved once a drag ends, not on every move
		if (splitDragging) return;
		try {
			if (commitsHeight === null) localStorage.removeItem(SPLIT_KEY);
			else localStorage.setItem(SPLIT_KEY, String(commitsHeight));
		} catch {
			// private windows and blocked storage just don't remember it
		}
	});

	const loading = slowNavigation();

	// warm the neighbouring commits so stepping with [ and ] is instant. SvelteKit keeps
	// one preload at a time, so the next commit is preloaded and the server just warms
	// up for the previous one, stepping through a branch mostly goes forward
	$effect(() => {
		if (data.mode !== 'commit') return;
		if (newer) preloadData(url(commitParams(newer)));
		if (older) {
			const params = url(commitParams(older)).slice(1);
			fetch(`${page.url.pathname.replace(/\/$/, '')}/__data.json?${params}`).catch(() => {});
		}
	});

	// switched in the browser only, so changing it never re-runs the diff
	// svelte-ignore state_referenced_locally
	let layout = $state(data.layout);

	const repoGuides = $derived(data.guides.filter((g) => g.repo === data.repo));

	// the dialog starts from what is on screen: the branch or commit, else the range
	const dialogInitial = $derived.by(() => {
		const onBranch = branchSel ?? (lane?.base ? lane : null);
		const sha = commit && lane?.commits.find((c) => sameSha(c.sha, commit.sha))?.sha;
		return {
			tab: onBranch || !range ? ('branch' as const) : ('range' as const),
			branch: onBranch?.name ?? suggestedBranch(),
			first: branchSel?.first ?? sha ?? null,
			last: branchSel?.last ?? sha ?? null,
			start: range?.from ?? 'HEAD~1',
			stop: range?.to ?? 'HEAD'
		};
	});

	const COMPARE_KEYS = ['from', 'to', 'branch', 'commits', 'commit', 'on'];

	/** The url with `next` applied, `reset` drops the current comparison first. */
	function url(next: Record<string, string | null>, reset = false) {
		// from where a navigation still loading is headed, so a second pick doesn't undo the first
		const params = new URLSearchParams((navigating.to?.url ?? page.url).searchParams);
		if (reset) COMPARE_KEYS.forEach((key) => params.delete(key));
		for (const [key, value] of Object.entries(next)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		return `?${params}`;
	}

	/** `noScroll` stays where the page is, for another look at the same diff */
	function navigate(next: Record<string, string | null>, reset = false, noScroll = false) {
		goto(url(next, reset), { keepFocus: true, noScroll });
	}

	/** Another commit on the same lane, pinned so stepping never wanders onto another branch. */
	function commitParams(sha: string) {
		return { commit: sha, on: lane?.name ?? (data.inputs.on || null) };
	}

	/** The commits in the sidebar: the branch being compared, or the lane of a single commit. */
	const sidebar = $derived.by(() => {
		if (branchSel) {
			const { name, commits, first, last } = branchSel;
			return { name, commits, first, last, whole: true };
		}
		if (!lane || !commit) return null;
		const sha = lane.commits.find((c) => sameSha(c.sha, commit.sha))?.sha ?? null;
		return { ...lane, first: sha, last: sha, whole: lane.base !== null };
	});

	/** One commit, a span or the whole branch, whichever mode fits what was picked. */
	function pickCommits(first: string | null, last: string | null) {
		if (!sidebar) return;
		const name = sidebar.name;
		if (!first || !last) navigate({ branch: name, view: null }, true);
		else if (first === last) navigate({ commit: first, on: name, view: null }, true);
		// the default branch has no whole-branch view to narrow, a range covers it
		else if (!sidebar.whole) {
			const [a, b] = [first, last].sort(
				(x, y) =>
					sidebar.commits.findIndex((c) => c.sha === x) -
					sidebar.commits.findIndex((c) => c.sha === y)
			);
			navigate({ from: `${a}^`, to: b, view: null }, true);
		} else navigate({ branch: name, commits: `${first}..${last}`, view: null }, true);
	}

	// a single commit is part of Branch, reached from the branch's commit list
	type Tab = 'worktree' | 'branch' | 'range';
	const MODES: { mode: Tab; label: string }[] = [
		{ mode: 'worktree', label: 'Uncommitted' },
		{ mode: 'branch', label: 'Branch' },
		{ mode: 'range', label: 'Range' }
	];
	const tab = $derived<Tab>(data.mode === 'commit' ? 'branch' : data.mode);

	/** The checked-out branch, or the most recent one that isn't the base. */
	function suggestedBranch(): string {
		if (data.branch && data.branch !== 'HEAD' && data.branch !== data.defaultBase) {
			return data.branch;
		}
		const other = data.branches.find((b) => b.kind === 'local' && b.name !== data.defaultBase);
		return other?.name ?? data.branch ?? 'HEAD';
	}

	function setMode(mode: Tab) {
		if (mode === tab) return;
		if (mode === 'branch') navigate({ branch: suggestedBranch(), view: null }, true);
		else if (mode === 'range')
			navigate({ from: range?.from ?? 'HEAD~1', to: range?.to ?? 'HEAD', view: null }, true);
		else navigate({ view: null }, true);
	}

	// [ and ] step to the older and newer commit
	function onkeydown(event: KeyboardEvent) {
		if (data.mode !== 'commit' || event.metaKey || event.ctrlKey || event.altKey) return;
		if (typing(event)) return;
		if (event.key === '[' && older) navigate(commitParams(older));
		if (event.key === ']' && newer) navigate(commitParams(newer));
	}

	function setChanges(mode: typeof data.changeMode) {
		// remembered for the next visit, the url keeps it shareable
		remember('changes', mode);
		navigate({ changes: mode === 'lines' ? null : mode }, false, true);
	}

	function openGuide(start: string, stop: string) {
		// stay on the branch when the guide covers what is on screen
		if (range && range.from === start && range.to === stop) navigate({ view: 'guide' });
		else navigate({ from: start, to: stop, view: 'guide' }, true);
	}
</script>

<svelte:head>
	<title>{repoName(data.repo)} · sloppy diff</title>
</svelte:head>

<svelte:window {onkeydown} />

<div class="min-h-screen font-sans">
	<header
		class="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-canvas px-4"
	>
		<span
			class="mr-1 grid size-6 shrink-0 place-items-center rounded-md border border-fg font-mono text-[12px]"
			title="sloppy diff">±</span
		>

		<RepoButton repo={data.repo} />

		{#if data.branches.length}
			<div class="ml-1 flex rounded-lg border border-line bg-surface p-0.5">
				{#each MODES as { mode, label } (mode)}
					<button
						type="button"
						class={[
							'h-6 rounded-md px-2.5 text-[12px]',
							tab === mode ? 'bg-subtle font-medium text-fg' : 'text-muted hover:text-fg'
						]}
						onclick={() => setMode(mode)}>{label}</button
					>
				{/each}
			</div>

			<div class="flex items-center gap-1.5">
				{#if data.mode === 'branch'}
					<RefPicker
						label="branch"
						value={data.inputs.branch}
						fallback=""
						branches={data.branches}
						commits={data.commits}
						only={['branches']}
						placeholder="Filter branches"
						onselect={(branch) => navigate({ branch, commits: null })}
					/>
					{#if branchSel}
						<!-- found from the history, a different base is a range -->
						<span
							class="flex h-8 items-center gap-1.5 px-1 text-[11.5px] text-muted"
							title={branchSel.merged
								? `Merged into ${branchSel.base}, shown against where it split off before the merge`
								: `Where ${branchSel.name} split off ${branchSel.base}, found from the history`}
						>
							<span class="text-faint">from</span>
							<span class="font-mono text-fg">{branchSel.base}</span>
							<span class="font-mono text-accent">{branchSel.mergeBase.slice(0, 7)}</span>
							{#if branchSel.merged}
								<span
									class="rounded-[4px] border border-line px-1 text-[10px] font-medium text-muted"
									>merged</span
								>
							{/if}
						</span>
					{/if}
					{#if span}
						<button
							type="button"
							class="flex h-6 items-center gap-1 rounded-md bg-accent/10 px-2 text-[11.5px] font-medium text-accent hover:bg-accent/15"
							title="Show the whole branch"
							onclick={() => navigate({ commits: null })}
						>
							{span.first === span.last
								? `commit ${span.first}`
								: `commits ${span.first}–${span.last}`} of {span.total}
							<svg
								viewBox="0 0 16 16"
								class="size-3"
								fill="none"
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg
							>
						</button>
					{/if}
				{:else if data.mode === 'commit'}
					<RefPicker
						label="branch"
						value={lane?.name ?? ''}
						fallback="on no branch"
						branches={data.branches}
						commits={[]}
						only={['branches']}
						placeholder="Filter branches"
						onselect={(branch) => navigate({ branch, view: null }, true)}
					/>
					<button
						type="button"
						class="grid size-8 place-items-center rounded-lg border border-line bg-surface text-muted hover:border-muted hover:text-fg disabled:opacity-40 disabled:hover:border-line disabled:hover:text-muted"
						title={older
							? 'Older commit  ['
							: commit
								? 'This is the first commit'
								: 'Pick a commit first'}
						aria-label="Older commit"
						disabled={!older}
						onclick={() => older && navigate(commitParams(older))}
					>
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="m10 3.5-4.5 4.5 4.5 4.5" /></svg
						>
					</button>
					<RefPicker
						label="commit"
						value={data.inputs.commit}
						fallback=""
						branches={data.branches}
						commits={lane ? [...lane.commits].reverse() : data.commits}
						more={lane?.earlier}
						moreLabel={lane?.base ? `Earlier on ${lane.base}` : ''}
						only={lane ? ['commits'] : ['commits', 'branches', 'tags']}
						placeholder={lane
							? `Filter commits on ${lane.name}`
							: 'Filter commits, or pick a branch or tag'}
						onselect={(sha) => navigate(commitParams(sha))}
					/>
					<button
						type="button"
						class="grid size-8 place-items-center rounded-lg border border-line bg-surface text-muted hover:border-muted hover:text-fg disabled:opacity-40 disabled:hover:border-line disabled:hover:text-muted"
						title={newer
							? 'Newer commit  ]'
							: commit
								? lane
									? `The newest commit on ${lane.name}`
									: 'No newer commit on any branch'
								: 'Pick a commit first'}
						aria-label="Newer commit"
						disabled={!newer}
						onclick={() => newer && navigate(commitParams(newer))}
					>
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg
						>
					</button>
					{#if lane && at >= 0}
						{@const label = position
							? `commit ${position.index} of ${position.total}`
							: `before ${lane.name}, on ${lane.base}`}
						{#if lane.base}
							<button
								type="button"
								class="flex h-6 items-center gap-1 rounded-md bg-accent/10 px-2 text-[11.5px] font-medium text-accent tabular-nums hover:bg-accent/15"
								title="Show the whole branch"
								onclick={() => navigate({ branch: lane.name, view: null }, true)}
							>
								{label}
								<svg
									viewBox="0 0 16 16"
									class="size-3"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg
								>
							</button>
						{:else}
							<!-- the default branch has no whole-branch view to go back to -->
							<span class="px-1 text-[11.5px] text-muted tabular-nums">{label}</span>
						{/if}
					{/if}
				{:else if data.mode === 'range'}
					<RefPicker
						label="from"
						value={data.inputs.from}
						fallback="HEAD"
						branches={data.branches}
						commits={data.commits}
						onselect={(from) => navigate({ from })}
					/>
					<button
						type="button"
						class="grid size-8 place-items-center rounded-lg border border-line bg-surface text-muted hover:border-muted hover:text-fg"
						title="Swap from and to"
						aria-label="Swap from and to"
						onclick={() => navigate({ from: data.inputs.to, to: data.inputs.from || 'HEAD' })}
					>
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M2.5 5.5h10l-3-3M13.5 10.5h-10l3 3" /></svg
						>
					</button>
					<RefPicker
						label="to"
						value={data.inputs.to}
						fallback=""
						branches={data.branches}
						commits={data.commits}
						onselect={(to) => navigate({ to })}
					/>
				{:else}
					<RefPicker
						label="vs"
						value={data.inputs.from}
						fallback={headLabel}
						branches={data.branches}
						commits={data.commits}
						onselect={(from) => navigate({ from })}
					/>
				{/if}
			</div>
		{/if}

		<div class="ml-auto flex shrink-0 items-center gap-3">
			{#if data.files.length > 0}
				<div class="flex items-center gap-3 font-mono text-[11px] text-muted tabular-nums">
					<span>{data.files.length} {data.files.length === 1 ? 'file' : 'files'}</span>
					<span>
						<span class="text-add">+{totals.additions}</span>
						<span class="text-del">−{totals.deletions}</span>
					</span>
				</div>
			{/if}
			{#if range}
				<div class="flex rounded-lg border border-line bg-surface p-0.5">
					{#each [{ view: 'files', label: 'Diff' }, { view: 'guide', label: 'Guide' }] as { view, label } (view)}
						<button
							type="button"
							class={[
								'flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[12px]',
								data.view === view ? 'bg-subtle font-medium text-fg' : 'text-muted hover:text-fg'
							]}
							onclick={() => navigate({ view: view === 'guide' ? 'guide' : null })}
						>
							{label}
							{#if view === 'guide' && data.guide}
								<span class="size-1.5 rounded-full bg-accent" title="A guide exists for this range"
								></span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
			<button
				type="button"
				class="flex h-8 items-center gap-1.5 rounded-lg border border-faint bg-accent/8 px-2.5 text-[12px] font-medium text-accent hover:bg-accent/14"
				title="Generate or open review guides"
				onclick={() => (dialogOpen = true)}
			>
				<svg
					viewBox="0 0 16 16"
					class="size-3.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path
						d="M8 2.5 9.3 6.2 13 7.5 9.3 8.8 8 12.5 6.7 8.8 3 7.5l3.7-1.3zM12.5 11.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"
					/></svg
				>
				Guides
				{#if repoGuides.length}
					<span
						class="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] text-surface tabular-nums"
						title="{repoGuides.length} saved for this repo">{repoGuides.length}</span
					>
				{/if}
			</button>
		</div>

		{#if loading.current}
			<div class="absolute inset-x-0 -bottom-px h-px overflow-hidden">
				<div class="loading h-full w-1/3 bg-accent"></div>
			</div>
		{/if}
	</header>

	{#snippet toolbar()}
		<!-- stays under the header so the change mode can be switched from anywhere -->
		<div
			class="sticky top-12 z-[15] -mx-4 -mt-4 flex h-11 items-center border-b border-line bg-canvas px-4"
		>
			<div class="min-w-0 flex-1">
				<ChangesToolbar
					mode={data.changeMode}
					summary={data.changes}
					onchange={setChanges}
					bind:layout
				/>
			</div>
			{#if asking && threads.list.length}
				<!-- every question about this diff, in the lens -->
				<button
					type="button"
					class="ml-3 flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12px] text-muted hover:border-muted hover:text-fg"
					title="Open the questions to Claude  q"
					onclick={() => threads.openLens()}
				>
					{#if threads.running}
						<span class="spin size-3 rounded-full border-[1.5px] border-ink-soft/40 border-t-ink"
						></span>
						{threads.running} answering
					{:else}
						Questions
						<span class="text-faint tabular-nums">{threads.list.length}</span>
					{/if}
				</button>
			{/if}
		</div>
	{/snippet}

	{#snippet nothing()}
		<p class="text-[13px] font-medium">No changes</p>
		<p class="mt-1 text-[12px] text-muted">
			{#if branchSel}
				<span class="font-mono">{branchSel.name}</span> has no changes since
				<span class="font-mono">{branchSel.base}</span>.
			{:else if commit}
				<span class="font-mono">{commit.sha}</span> changes no files.
			{:else if data.mode === 'worktree'}
				Nothing uncommitted.
			{:else}
				The two revisions are identical.
			{/if}
		</p>
	{/snippet}

	{#snippet saved()}
		{#if data.guides.length}
			<div class="mt-6 w-full max-w-md rounded-xl border border-line bg-surface p-2 text-left">
				<p class="px-2 pt-1 pb-1.5 text-[10.5px] font-medium tracking-wide text-faint uppercase">
					Saved guides
				</p>
				<SavedGuides guides={data.guides} repo={data.repo} />
			</div>
		{/if}
	{/snippet}

	{#if data.error}
		<div class="flex flex-col items-center px-4 py-24">
			<div class="w-full max-w-md rounded-xl border border-line bg-surface p-5">
				<p class="flex items-center gap-2 text-[13px] font-medium">
					<span class="size-1.5 rounded-full bg-del"></span>
					Couldn't read a diff
				</p>
				<p class="mt-1.5 font-mono text-[12px] break-words text-muted">{data.error}</p>
				{#if !data.branches.length}
					<p class="mt-3 text-[12px] text-faint">Pick one of the repositories on this machine:</p>
				{/if}
			</div>
			{#if !data.branches.length}
				<div
					class="mt-3 w-full max-w-md overflow-hidden rounded-xl border border-line bg-surface text-left"
				>
					<RepoList
						current={data.repo}
						height="max-h-96"
						onpick={(repo) => goto(`?${new URLSearchParams({ repo })}`)}
					/>
				</div>
			{/if}
			{@render saved()}
		</div>
	{:else if data.view === 'guide' && data.guide}
		<GuideView
			guide={data.guide}
			files={data.files}
			{toolbar}
			{layout}
			{virtualize}
			threads={asking}
			onregenerate={() => (dialogOpen = true)}
		/>
	{:else if data.view === 'guide'}
		<div class="flex flex-col items-center px-4 py-24 text-center">
			<p class="text-[13px] font-medium">No guide for this range yet</p>
			<p class="mt-1 max-w-sm text-[12px] text-muted">
				Claude Code can split these changes into sections to review in order. Guides are saved per
				commit range, a branch keeps its guide through new commits and rebases.
			</p>
			<button
				type="button"
				class="mt-4 h-8 rounded-lg bg-accent px-3 text-[12px] font-medium text-surface hover:opacity-90"
				onclick={() => (dialogOpen = true)}>Generate a guide</button
			>
			{@render saved()}
		</div>
	{:else if data.files.length === 0 && !sidebar}
		<div class="flex flex-col items-center px-4 py-24 text-center">
			{@render nothing()}
			{@render saved()}
		</div>
	{:else}
		<SidebarLayout {layout}>
			{#snippet aside()}
				{#if sidebar}
					<!-- sized to its content until the handle below is dragged -->
					<div
						bind:this={commitsPanel}
						class={[
							'flex min-h-0 shrink-0 flex-col',
							// a remembered height still leaves the files room in a smaller window
							commitsHeight === null ? 'max-h-[40%]' : 'max-h-[calc(100%-6rem)]'
						]}
						style:height={commitsHeight === null ? null : `${commitsHeight}px`}
					>
						<!-- one list for both modes: a single commit, a span or the whole branch -->
						<CommitList
							fill
							commits={sidebar.commits}
							first={sidebar.first}
							last={sidebar.last}
							name={sidebar.name}
							canShowAll={sidebar.whole}
							onselect={pickCommits}
						/>
					</div>
					<ResizeHandle
						bind:size={commitsHeight}
						bind:dragging={splitDragging}
						panel={commitsPanel}
						label="Resize the commit and file lists"
					/>
				{/if}
				<!-- the list scrolls inside, its header stays put -->
				<div class="flex min-h-0 flex-1 flex-col">
					<FileList files={data.files} current={reading.current} />
				</div>
			{/snippet}
			{#snippet rail()}
				<!-- each file's status, to jump to it -->
				{#each data.files as file (file.id)}
					{@const here = file.id === reading.current}
					<a
						href="#{file.id}"
						class={[
							'grid shrink-0 place-items-center rounded-md p-0.5 hover:bg-subtle',
							here && 'bg-subtle ring-1 ring-muted'
						]}
						aria-current={here ? 'location' : undefined}
						aria-label={displayPath(file)}
						data-tip={displayPath(file)}><StatusBadge status={file.status} /></a
					>
				{/each}
			{/snippet}
			<main class="flex min-w-0 flex-col gap-4 p-4 pb-24">
				{@render toolbar()}
				{#if commit}
					<CommitCard {commit} />
				{/if}
				{#each data.files as file (file.id + file.newPath)}
					<FileDiff {file} {layout} {virtualize} threads={asking} remember={data.repo} />
				{:else}
					<!-- the commit list stays, so an empty commit is one step on the way -->
					<div class="flex flex-col items-center py-16 text-center">{@render nothing()}</div>
				{/each}
			</main>
		</SidebarLayout>
	{/if}
</div>

{#if asking}
	<!-- the question composer, the peek on markers and the lens, one of each for the page -->
	<AskLayer threads={asking} files={data.files} guide={data.view === 'guide' ? data.guide : null} />
{/if}

{#if dialogOpen}
	<GuideDialog
		repo={data.repo}
		initial={dialogInitial}
		guides={data.guides}
		branches={data.branches}
		commits={data.commits}
		canGenerate={data.commits.length > 0}
		onopen={openGuide}
		onclose={() => (dialogOpen = false)}
	/>
{/if}

<style>
	.loading {
		animation: slide 1s ease-in-out infinite;
	}
	.spin {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}
</style>
