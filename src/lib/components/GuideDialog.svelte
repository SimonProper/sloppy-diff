<script lang="ts">
	import { modal } from '$lib/modal';
	import Button from '$lib/components/Button.svelte';
	import { cubicOut } from 'svelte/easing';
	import { fade, slide } from 'svelte/transition';
	import { errorText } from '$lib/errors';
	import { getBranch, getRange } from '$lib/guide/guides.remote';
	import { guideJob, openIfStill } from '$lib/guide/job.svelte';
	import type { GuideListing } from '$lib/guide/types';
	import { timeAgo, type Branch, type Commit } from '$lib/refs';
	import CommitList from './CommitList.svelte';
	import RefPicker from './RefPicker.svelte';
	import SavedGuides from './SavedGuides.svelte';
	import GuideRunning from './GuideRunning.svelte';
	import SegmentedControl from './SegmentedControl.svelte';

	interface Props {
		repo: string;
		/** what to start from, usually the current comparison */
		initial: {
			tab: Tab;
			branch: string;
			/** a span of the branch's commits, null for all of it */
			first: string | null;
			last: string | null;
			start: string;
			stop: string;
		};
		guides: GuideListing[];
		branches: Branch[];
		commits: Commit[];
		/** false when the open repo can't produce a diff, only saved guides are offered */
		canGenerate: boolean;
		/** for the span on screen, `initial`'s range, with nothing to pick */
		onscreen?: boolean;
		/** the pull request the range is, for the agent to read */
		pr?: number;
		/** show the finished or chosen guide */
		onopen: (start: string, stop: string) => void;
		onclose: () => void;
	}

	let {
		repo,
		initial,
		guides,
		branches,
		commits,
		canGenerate,
		onscreen = false,
		pr,
		onopen,
		onclose
	}: Props = $props();

	// a branch, or part of it, like Branch mode, or any two revisions like Range
	type Tab = 'branch' | 'range';
	// svelte-ignore state_referenced_locally
	let tab = $state<Tab>(onscreen ? 'range' : initial.tab);
	// svelte-ignore state_referenced_locally
	let branch = $state(initial.branch);
	// svelte-ignore state_referenced_locally
	let first = $state(initial.first);
	// svelte-ignore state_referenced_locally
	let last = $state(initial.last);
	// svelte-ignore state_referenced_locally
	let start = $state(initial.start);
	// svelte-ignore state_referenced_locally
	let stop = $state(initial.stop);

	let info = $state<Awaited<ReturnType<typeof getBranch>> | null>(null);
	let infoError = $state('');
	const branchNeedsRange = $derived(info?.status === 'no-unpushed-commits' && info.name === branch);

	$effect(() => {
		if (!canGenerate || tab !== 'branch' || !branch) return;
		let stale = false;
		infoError = '';
		getBranch({ repo, branch }).then(
			(value) => {
				if (!stale) info = value;
			},
			(e) => {
				if (stale) return;
				info = null;
				infoError = errorText(e);
			}
		);
		return () => (stale = true);
	});

	/** What the guide covers: the whole branch, a span of it, or the range. */
	const target = $derived.by(() => {
		if (tab === 'range') return { start, stop };
		if (!info || info.status !== 'ready' || info.name !== branch) return null;
		if (!first || !last) return { start: info.mergeBase, stop: info.tip };
		const commits = info.commits;
		const at = (sha: string) => commits.findIndex((c) => c.sha === sha);
		const [a, b] = at(first) <= at(last) ? [first, last] : [last, first];
		return { start: `${a}^`, stop: b };
	});

	function setTab(next: Tab) {
		// the range starts out as whatever the branch covered
		if (next === 'range' && target) ({ start, stop } = target);
		tab = next;
	}

	function chooseCommitRange() {
		// A first commit's parent resolves to the empty tree, so this also works
		// when the selected branch has only one commit or HEAD is somewhere else.
		start = `${branch}^`;
		stop = branch;
		tab = 'range';
	}

	let range = $state<Awaited<ReturnType<typeof getRange>> | null>(null);
	let rangeError = $state('');

	$effect(() => {
		// whatever was loaded belongs to the previous choice, "Open existing guide" and
		// Generate must never act on it
		range = null;
		rangeError = '';
		if (!canGenerate || !target) return;
		let stale = false;
		getRange({ repo, ...target }).then(
			(value) => {
				if (stale) return;
				range = value;
				// pick up a generation that is already running for this range
				if (range.running && !guideJob.running)
					guideJob.follow(
						{ repo, start: range.start, stop: range.stop },
						range.commits.length,
						openIfStill(onopen)
					);
			},
			(e) => {
				if (stale) return;
				range = null;
				rangeError = errorText(e);
			}
		);
		return () => (stale = true);
	});

	// the commits come in after the dialog opens, they open up under their count instead of
	// pushing the buttons down in one jump
	const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const reveal = () => ({ duration: still() ? 0 : 220, easing: cubicOut });

	// writing a new guide, or the ones already written. Spanning what's on screen is only
	// ever a new one
	type View = 'new' | 'saved';
	// svelte-ignore state_referenced_locally
	let view = $state<View>(canGenerate || onscreen ? 'new' : 'saved');

	function open(start: string, stop: string) {
		onclose();
		onopen(start, stop);
	}

	// the dialog closes, the progress shows on the page while the agent writes
	function generate() {
		if (!target || !range) return;
		const resolved = { start: range.start, stop: range.stop, commits: range.commits.length };
		guideJob.generate({ repo, ...target, pr }, resolved, openIfStill(onopen));
		onclose();
	}
</script>

<dialog
	{@attach modal}
	oncancel={(e) => {
		e.preventDefault();
		onclose();
	}}
	onclick={(e) => {
		if (e.target === e.currentTarget) onclose();
	}}
	class="m-auto w-[36rem] max-w-[calc(100vw-2rem)] overflow-visible bg-transparent p-0 text-fg backdrop:bg-black/25 backdrop:backdrop-blur-[2px]"
>
	<div
		class={[
			'flex flex-col rounded-2xl border border-line bg-surface shadow-[0_24px_80px_-24px_rgb(0_0_0/0.35)]',
			// switching tabs keeps its height
			!onscreen && 'h-[32rem]'
		]}
	>
		<div class="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
			{#if onscreen}
				<h2 class="px-1 text-[14px] font-semibold">Review guide</h2>
			{:else}
				<SegmentedControl
					options={[
						{ value: 'new', label: 'New guide' },
						{ value: 'saved', label: 'Saved' }
					]}
					value={view}
					onchange={(v) => (view = v)}
					ghost
					label="Guides"
				>
					{#snippet after(option)}
						{#if option.value === 'saved' && guides.length}
							<span class="text-[11px] text-faint tabular-nums">{guides.length}</span>
						{/if}
					{/snippet}
				</SegmentedControl>
			{/if}
			<Button variant="ghost" icon aria-label="Close" onclick={onclose}>
				<svg
					viewBox="0 0 16 16"
					class="size-3.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8" /></svg
				>
			</Button>
		</div>

		{#if view === 'saved'}
			<div class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
				{#if guides.length}
					<SavedGuides {guides} {repo} onnavigate={onclose} />
				{:else}
					<p class="px-2 py-6 text-center text-[12px] text-faint">No saved guides yet.</p>
				{/if}
			</div>
		{:else if !canGenerate}
			<p class="flex-1 px-5 py-4 text-[12.5px] text-muted">
				This repo has no commit history to guide yet. Open a repo with commits to generate a guide{guides.length
					? ', or open a saved one'
					: ''}.
			</p>
		{:else if guideJob.running}
			<div class="flex-1 px-5 py-5">
				<GuideRunning plate="var(--surface)" />
			</div>

			<div class="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
				<p class="text-[11.5px] text-faint">Closing keeps it running in the background.</p>
				<Button variant="danger" size="lg" class="font-medium" onclick={() => guideJob.cancel()}
					>Cancel</Button
				>
			</div>
		{:else}
			<div class="flex flex-1 flex-col gap-4 px-5 py-4">
				<p class="text-[12px] text-muted">
					Your selected agent reads the commits and splits the change into sections to review in
					order.
				</p>
				{#if !onscreen}
					<div class="flex items-center gap-2">
						<SegmentedControl
							options={[
								{ value: 'branch', label: 'Branch' },
								{ value: 'range', label: 'Range' }
							]}
							value={tab}
							onchange={setTab}
							size="lg"
							label="Guide"
						/>
						{#if tab === 'branch'}
							<RefPicker
								label="branch"
								value={branch}
								fallback=""
								{branches}
								{commits}
								only={['branches']}
								placeholder="Filter branches"
								onselect={(v) => {
									branch = v;
									first = last = null;
								}}
							/>
						{/if}
					</div>
				{/if}

				{#if tab === 'branch'}
					<div class="rounded-xl border border-line">
						{#if branchNeedsRange}
							<div class="flex items-start gap-3 px-4 py-4">
								<span
									class="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-subtle text-muted"
									aria-hidden="true"
								>
									<svg
										viewBox="0 0 16 16"
										class="size-4"
										fill="none"
										stroke="currentColor"
										stroke-width="1.4"
										stroke-linecap="round"
										stroke-linejoin="round"
										><circle cx="4.5" cy="3.5" r="1.5" /><circle
											cx="4.5"
											cy="12.5"
											r="1.5"
										/><circle cx="11.5" cy="5" r="1.5" /><path
											d="M4.5 5v6M11.5 6.5c0 3-7 2-7 4.5"
										/></svg
									>
								</span>
								<div>
									<p class="text-[12.5px] font-medium">
										No unpushed commits on <span class="font-mono">{branch}</span>
									</p>
									<p class="mt-1 max-w-sm text-[12px] leading-relaxed text-muted">
										Choose a commit range to create a guide from changes already in this branch’s
										history.
									</p>
								</div>
							</div>
						{:else if infoError}
							<p class="flex items-center gap-1.5 px-3 py-2.5 text-[11.5px] text-del">
								<span class="size-1.5 rounded-full bg-del"></span>{infoError}
							</p>
						{:else if info?.status === 'ready' && info.name === branch}
							<p
								class="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[11.5px] text-muted"
							>
								<span class="text-faint">from</span>
								<span class="font-mono text-fg">{info.base}</span>
								<span class="font-mono text-accent">{info.mergeBase.slice(0, 7)}</span>
								{#if info.merged}
									<span
										class="rounded-sm border border-line px-1 text-[10px] font-medium text-muted"
										>merged</span
									>
								{/if}
							</p>
							<!-- the same list as the sidebar: one commit, a span, or the whole branch -->
							<CommitList
								commits={info.commits}
								{first}
								{last}
								onselect={(a, b) => {
									first = a;
									last = b;
								}}
							/>
						{:else}
							<p class="px-3 py-2.5 text-[11.5px] text-muted">Loading commits…</p>
						{/if}
					</div>
				{:else if !onscreen}
					<div class="flex items-center gap-2">
						<RefPicker
							label="start"
							value={start}
							fallback=""
							{branches}
							{commits}
							onselect={(v) => (start = v)}
						/>
						<svg
							viewBox="0 0 16 16"
							class="size-3.5 shrink-0 text-faint"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" /></svg
						>
						<RefPicker
							label="stop"
							value={stop}
							fallback=""
							{branches}
							{commits}
							onselect={(v) => (stop = v)}
						/>
					</div>
				{/if}

				{#if tab === 'range'}
					<div class="rounded-xl border border-line">
						<p
							class="flex items-center justify-between border-b border-line px-3 py-2 text-[11.5px] text-muted"
						>
							{#if rangeError}
								<span class="flex items-center gap-1.5 text-del">
									<span class="size-1.5 rounded-full bg-del"></span>{rangeError}
								</span>
							{:else if range}
								<span>
									{range.commits.length}
									{range.commits.length === 1 ? 'commit' : 'commits'} in range
								</span>
								<span class="font-mono text-faint"
									>{range.start.slice(0, 7)}..{range.stop.slice(0, 7)}</span
								>
							{:else}
								<span>Loading commits…</span>
							{/if}
						</p>
						{#if range}
							<div class="max-h-44 overflow-y-auto" in:slide={reveal()}>
								<div class="p-1" in:fade={reveal()}>
									{#each range.commits as commit (commit.sha)}
										<div class="flex items-center gap-2.5 rounded-lg px-2 py-1 text-[12px]">
											<span class="shrink-0 font-mono text-[11px] text-accent">{commit.sha}</span>
											<span class="min-w-0 flex-1 truncate">{commit.subject}</span>
											<span class="shrink-0 text-[11px] text-faint tabular-nums"
												>{timeAgo(commit.date)}</span
											>
										</div>
									{:else}
										<p class="px-2 py-3 text-center text-[12px] text-faint">
											No commits between these two points. Is start an ancestor of stop?
										</p>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{:else if rangeError}
					<p class="flex items-center gap-1.5 text-[12px] text-del">
						<span class="size-1.5 rounded-full bg-del"></span>{rangeError}
					</p>
				{/if}

				{#if guideJob.failure}
					<p class="flex items-center gap-1.5 text-[12px] text-del">
						<span class="size-1.5 rounded-full bg-del"></span>{guideJob.failure}
					</p>
				{/if}
			</div>

			<div class="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
				{#if tab === 'branch' && branchNeedsRange}
					<Button variant="solid" size="lg" onclick={chooseCommitRange}>
						Choose a commit range
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"><path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" /></svg
						>
					</Button>
				{:else}
					{#if range?.hasGuide}
						<Button
							size="lg"
							class="font-medium"
							onclick={() => range && open(range.start, range.stop)}>Open existing guide</Button
						>
					{/if}
					<Button
						variant="solid"
						size="lg"
						disabled={!target || !range || range.commits.length === 0}
						onclick={generate}
					>
						{range?.hasGuide ? 'Regenerate' : 'Generate guide'}
					</Button>
				{/if}
			</div>
		{/if}
	</div>
</dialog>
