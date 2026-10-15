<script lang="ts">
	import { page } from '$app/state';
	import { addComment } from '$lib/pr/pr.remote';
	import { refresh } from '$lib/pr/refresh';
	import type { Check, CheckOutcome, PrComment, PullRequest, ReviewThread } from '$lib/pr/types';
	import Avatar from './Avatar.svelte';
	import Comment from './Comment.svelte';
	import CommentField from './CommentField.svelte';
	import StartedThreads from './StartedThreads.svelte';

	interface Props {
		pr: PullRequest;
		/** goes to a review comment's thread in the diff */
		onjump: (thread: ReviewThread) => void;
		/** adds a reply to a review thread to your pending review */
		onreply?: (thread: string, body: string) => Promise<unknown>;
	}

	let { pr, onjump, onreply }: Props = $props();

	async function post(body: string) {
		await addComment({ repo: page.data.repo, pr: pr.id, body });
		await refresh();
	}

	const status = $derived(pr.isDraft && pr.state === 'OPEN' ? 'Draft' : pr.state.toLowerCase());

	/** A ring for the end of a branch line in an icon, centred on x, y. */
	const ring = (x: number, y: number) => `M${x + 1.5} ${y}a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0`;

	const branch = $derived.by((): [string, string] | null => {
		if (pr.state !== 'OPEN') return null;
		if (pr.mergeable === 'CONFLICTING') return [`Conflicts with ${pr.baseRefName}`, 'text-del'];
		if (pr.behind === null) return null;
		if (pr.behind === 0) return [`Up to date with ${pr.baseRefName}`, 'text-muted'];
		const commits = pr.behind === 1 ? 'commit' : 'commits';
		return [`${pr.behind} ${commits} behind ${pr.baseRefName}`, 'text-mod'];
	});

	// where the reviews stand, in a few words beside the faces
	const verdicts = $derived(
		(
			[
				['APPROVED', 'approved'],
				['CHANGES_REQUESTED', 'changes requested'],
				['COMMENTED', 'commented'],
				['REQUESTED', 'waiting']
			] as const
		).flatMap(([state, words]) => {
			const n = pr.reviewers.filter((r) => r.state === state).length;
			return n ? [`${n} ${words}`] : [];
		})
	);

	const threads = $derived(new Map(pr.threads.map((t) => [t.id, t])));
	// every comment the activity shows: its entries that say something, and the threads'
	const total = $derived(
		pr.comments.filter((c) => !c.review || c.body.trim()).length +
			pr.comments.reduce(
				(n, c) =>
					n + (c.threads ?? []).reduce((m, id) => m + (threads.get(id)?.comments.length ?? 0), 0),
				0
			)
	);
	const said = (c: PrComment) => c.html || c.threads?.length;

	const settledOutcome = (r: Check) => r.outcome === 'passed' || r.outcome === 'skipped';
	const unsettled = $derived(pr.checks?.runs.filter((r) => !settledOutcome(r)) ?? []);
	const settled = $derived(pr.checks?.runs.filter(settledOutcome) ?? []);
	// the checks that need nothing from you, in a few words
	const done = $derived(
		[
			pr.checks?.passed && `${pr.checks.passed} passed`,
			pr.checks?.skipped && `${pr.checks.skipped} skipped`
		]
			.filter(Boolean)
			.join(' · ')
	);

	// a check's icon and its colour
	const OUTCOME: Record<CheckOutcome, [string, string]> = {
		failing: ['M5 5l6 6M11 5l-6 6', 'text-del'],
		running: ['M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11M8 5.5V8l1.5 1.5', 'text-mod'],
		passed: ['M3.5 8.5l3 3 6-6.5', 'text-add'],
		skipped: ['M4.5 8h7', 'text-faint']
	};
	const took = (seconds: number) => {
		const s = Math.round(seconds);
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
	};
</script>

<!-- what the pull request is, a card like the guide's summary, and where it stands in a
     strip along its foot. What people said under it -->
<div class="flex flex-col gap-6">
	<section class="overflow-hidden rounded-xl border border-line bg-surface">
		<div class="p-5">
			<h1 class="text-[17px] leading-snug font-semibold tracking-tight">
				{pr.title} <span class="font-normal text-faint">#{pr.number}</span>
			</h1>
			<p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
				<span
					class={[
						'rounded-sm border px-1 text-[10.5px] font-medium capitalize',
						pr.state === 'OPEN' && !pr.isDraft && 'border-add/40 bg-add/10 text-add',
						pr.state === 'MERGED' && 'border-move/40 bg-move/10 text-move',
						pr.state === 'CLOSED' && 'border-del/40 bg-del/10 text-del',
						pr.isDraft && pr.state === 'OPEN' && 'border-line text-muted'
					]}>{status}</span
				>
				<span class="flex items-center gap-1.5 text-muted"
					><Avatar src={pr.avatar} />{pr.author}</span
				>
				<span>·</span>
				<span class="font-mono text-[11px]">
					<span class="text-fg">{pr.baseRefName}</span> ←
					<span class="text-fg">{pr.headRefName}</span>
				</span>
			</p>
			{#if pr.bodyHtml}
				<div class="prose mt-4 max-w-3xl text-[13px] leading-relaxed">{@html pr.bodyHtml}</div>
			{/if}
		</div>

		{#if pr.reviewers.length || pr.checks || branch || pr.issues.length}
			<div
				class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line bg-subtle px-5 py-2.5 text-[12px] text-muted"
			>
				{#if pr.reviewers.length}
					<span class="flex items-center gap-2">
						<span class="flex -space-x-1">
							{#each pr.reviewers as reviewer (reviewer.name)}
								{@const requested = reviewer.state === 'REQUESTED'}
								<span
									class={['relative flex', requested && 'opacity-50']}
									title="{reviewer.name}: {requested
										? 'review requested'
										: reviewer.state.toLowerCase().replace('_', ' ')}"
								>
									<Avatar src={reviewer.avatar} />
									{#if reviewer.state === 'APPROVED'}
										{@render badge('M3 6.2 5 8l4-4.5', 'text-add')}
									{:else if reviewer.state === 'CHANGES_REQUESTED'}
										{@render badge('M3.5 3.5l5 5M8.5 3.5l-5 5', 'text-del')}
									{/if}
								</span>
							{/each}
						</span>
						{verdicts.join(' · ')}
					</span>
				{/if}

				{#if pr.checks}
					{@const { failing, running } = pr.checks}
					<a
						class="flex items-center gap-1.5 hover:text-fg"
						href="{pr.url}/checks"
						target="_blank"
						rel="noopener noreferrer"
					>
						{@render icon(
							'M2 4.5l1.2 1.2L5.5 3.5M2 10l1.2 1.2L5.5 9M8 4.5h6M8 10h6',
							failing ? 'text-del' : running ? 'text-mod' : 'text-faint'
						)}
						{#if failing}<span class="text-del">{failing} failing</span>{/if}
						{#if running}<span class="text-mod">{running} running</span>{/if}
						{done}
					</a>
				{/if}

				{#if branch}
					<span class={['flex items-center gap-1.5', branch[1]]}>
						{@render icon(
							ring(4, 3.5) + ring(4, 12.5) + ring(12, 5) + 'M4 5v6M12 6.5c0 3-4 3-7 5',
							branch[1] === 'text-muted' ? 'text-faint' : branch[1]
						)}
						{branch[0]}
					</span>
				{/if}

				{#each pr.issues as issue (issue.number)}
					<a
						class="flex min-w-0 items-center gap-1.5 hover:text-fg"
						href={issue.url}
						target="_blank"
						rel="noopener noreferrer"
						title={issue.title}
					>
						{@render icon('M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11M8 7.5v1', 'text-faint')}
						Closes <span class="font-mono text-[11px] text-fg">#{issue.number}</span>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<!-- each check on the head commit, a row that opens where it ran. Failing and running ones
	     in sight, the passed and skipped folded under one row -->
	{#if pr.checks}
		<section class="max-w-3xl">
			<h2 class="px-1 text-[12px] font-medium text-muted">
				Checks <span class="ml-1 font-normal text-faint tabular-nums">{pr.checks.runs.length}</span>
			</h2>
			<div
				class="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface"
			>
				{#each unsettled as run, i (i)}
					{@render check(run)}
				{/each}
				{#if settled.length}
					<details class="group">
						<summary
							class="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-[12px] text-muted hover:bg-subtle [&::-webkit-details-marker]:hidden"
						>
							<svg
								viewBox="0 0 16 16"
								class="size-3.5 shrink-0 text-faint transition-transform group-open:rotate-90"
								fill="none"
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="m6 4 4 4-4 4" /></svg
							>
							{done}
						</summary>
						<div class="divide-y divide-line border-t border-line">
							{#each settled as run, i (i)}
								{@render check(run)}
							{/each}
						</div>
					</details>
				{/if}
			</div>
		</section>
	{/if}

	<!-- read top to bottom, all of it: entries are cards on the page, threads a step lighter
	     inside them. A verdict without words is a line between the cards. Yours goes last -->
	<section class="max-w-3xl">
		<h2 class="px-1 text-[12px] font-medium text-muted">
			Activity <span class="ml-1 font-normal text-faint tabular-nums">{total}</span>
		</h2>
		<ul class="mt-3 flex flex-col gap-3">
			{#each pr.comments as comment (comment.id)}
				<li
					class={said(comment)
						? 'rounded-lg border border-line bg-surface px-3.5 py-3'
						: 'px-[15px]'}
				>
					<Comment {comment} threads={comment.threads?.length} />
					{#if comment.threads?.length}
						<div class="pl-7">
							<StartedThreads
								ids={comment.threads}
								{threads}
								{onjump}
								{onreply}
								avatar={pr.viewerAvatar}
							/>
						</div>
					{/if}
				</li>
			{/each}
			<li class="overflow-hidden rounded-lg border border-line bg-surface">
				<CommentField
					onsend={post}
					keep={pr.id}
					avatar={pr.viewerAvatar}
					placeholder="Leave a comment…"
					action="Comment"
					hint="⌘↵ to comment"
				/>
			</li>
		</ul>
	</section>
</div>

{#snippet check(run: Check)}
	<svelte:element
		this={run.url ? 'a' : 'div'}
		href={run.url || undefined}
		target={run.url ? '_blank' : undefined}
		rel={run.url ? 'noopener noreferrer' : undefined}
		class={['flex items-center gap-2 px-3.5 py-2 text-[12px]', run.url && 'hover:bg-subtle']}
	>
		{@render icon(OUTCOME[run.outcome][0], OUTCOME[run.outcome][1])}
		<span class="min-w-0 truncate">
			{#if run.workflow}<span class="text-faint">{run.workflow} /</span>{/if}
			{run.name}
		</span>
		<span class="ml-auto shrink-0 text-[11px] text-faint tabular-nums">
			{run.seconds === null ? run.outcome : took(run.seconds)}
		</span>
	</svelte:element>
{/snippet}

{#snippet icon(d: string, colour: string)}
	<svg
		viewBox="0 0 16 16"
		class={['size-3.5 shrink-0', colour || 'text-faint']}
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path {d} />
	</svg>
{/snippet}

<!-- a reviewer's verdict on the corner of their avatar -->
{#snippet badge(d: string, colour: string)}
	<span class="absolute -right-1 -bottom-1 grid size-2.5 place-items-center rounded-full bg-canvas">
		<svg
			viewBox="0 0 12 12"
			class={['size-2.5', colour]}
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"><path {d} /></svg
		>
	</span>
{/snippet}
