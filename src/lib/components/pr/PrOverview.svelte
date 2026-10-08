<script lang="ts">
	import type { PrComment, PullRequest, ReviewThread } from '$lib/pr/types';
	import Avatar from './Avatar.svelte';
	import Comment from './Comment.svelte';
	import StartedThreads from './StartedThreads.svelte';

	interface Props {
		pr: PullRequest;
		/** goes to a review comment's thread in the diff */
		onjump: (thread: ReviewThread) => void;
	}

	let { pr, onjump }: Props = $props();

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
						'rounded-[4px] border px-1 text-[10.5px] font-medium capitalize',
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
					{@const { failing, running, passed, skipped } = pr.checks}
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
						{[passed && `${passed} passed`, skipped && `${skipped} skipped`]
							.filter(Boolean)
							.join(' · ')}
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

	<!-- read top to bottom, all of it: entries are cards on the page, threads a step lighter
	     inside them. A verdict without words is a line between the cards -->
	{#if pr.comments.length}
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
								<StartedThreads ids={comment.threads} {threads} {onjump} />
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

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
