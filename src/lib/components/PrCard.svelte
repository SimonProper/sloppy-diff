<script lang="ts">
	import type { PrComment, PullRequest, ReviewThread } from '$lib/pr/types';
	import { timeAgo } from '$lib/refs';
	import Comment, { VERDICTS } from './pr/Comment.svelte';
	import StartedThreads from './pr/StartedThreads.svelte';

	interface Props {
		pr: PullRequest;
		/** goes to a review comment's thread in the diff */
		onjump: (thread: ReviewThread) => void;
	}

	let { pr, onjump }: Props = $props();

	const status = $derived(pr.isDraft && pr.state === 'OPEN' ? 'Draft' : pr.state.toLowerCase());

	// the conversation's newest, the ones to act on. Hiding two or fewer isn't worth a button
	const LATEST = 3;
	// the pull request shown in full, so picking another starts it folded again
	let expandedFor = $state<string | null>(null);
	const hidden = $derived(
		expandedFor === pr.id || pr.comments.length - LATEST <= 2 ? 0 : pr.comments.length - LATEST
	);
	const threads = $derived(new Map(pr.threads.map((t) => [t.id, t])));
	// the comments in the threads reviews started, replies and all
	const inThreads = $derived(
		pr.comments.flatMap((c) => (c.threads ?? []).flatMap((id) => threads.get(id)?.comments ?? []))
	);
	// the newest comment anywhere says where the review stands
	const latest = $derived(
		[...pr.comments, ...inThreads].reduce<PrComment | undefined>(
			(newest, c) => (!newest || c.createdAt > newest.createdAt ? c : newest),
			undefined
		)
	);
	// every comment the band shows opened. A review without words is only its verdict
	const total = $derived(
		pr.comments.filter((c) => !c.review || c.body.trim()).length + inThreads.length
	);
	const verdict = $derived(latest?.review && VERDICTS[latest.review]);
</script>

<div class="rounded-xl border border-line bg-surface px-4 py-3.5">
	<h2 class="text-[14.5px] leading-snug font-semibold tracking-tight">
		{pr.title} <span class="font-normal text-faint">#{pr.number}</span>
	</h2>
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
		<span class="text-muted">{pr.author}</span>
		<span>·</span>
		<span class="font-mono text-[11px]">
			<span class="text-fg">{pr.baseRefName}</span> ← <span class="text-fg">{pr.headRefName}</span>
		</span>
		<span>·</span>
		<a class="text-accent hover:underline" href={pr.url} target="_blank" rel="noopener noreferrer"
			>Open on GitHub</a
		>
	</p>
	{#if pr.bodyHtml}
		<div class="prose mt-3 max-w-3xl text-[12.5px] leading-relaxed text-muted">
			{@html pr.bodyHtml}
		</div>
	{/if}
	<!-- a band of its own under what the PR is, folded to a line so the diff starts where
	     it would without it. The line says where the review stands -->
	{#if latest}
		{#key pr.id}
			<details class="group -mx-4 mt-3.5 -mb-3.5 rounded-b-xl border-t border-line bg-canvas">
				<summary
					class="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-[11.5px] text-faint [&::-webkit-details-marker]:hidden"
				>
					<svg
						viewBox="0 0 16 16"
						class="size-3 shrink-0 transition-transform duration-150 ease-out group-open:rotate-90 group-hover:text-fg"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="m6 4 4 4-4 4" /></svg
					>
					<span class="text-[12px] font-medium text-fg tabular-nums"
						>{total} {total === 1 ? 'comment' : 'comments'}</span
					>
					<span>·</span>
					<span>latest {latest.author}</span>
					{#if verdict}
						<span class={['rounded-[4px] border px-1 text-[10px] font-medium', verdict[1]]}
							>{verdict[0]}</span
						>
					{/if}
					<span>{timeAgo(latest.createdAt)} ago</span>
				</summary>
				<!-- each entry a card of its own with room around it. A verdict without words
				     is only something that happened, a line between the cards -->
				<ul class="flex flex-col gap-3 border-t border-line px-3 py-3">
					{#if hidden}
						<li class="px-[15px]">
							<button
								type="button"
								class="text-[11.5px] text-faint hover:text-fg"
								onclick={() => (expandedFor = pr.id)}>Show {hidden} earlier</button
							>
						</li>
					{/if}
					{#each pr.comments.slice(hidden) as comment (comment.id)}
						<li
							class={comment.html || comment.threads?.length
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
			</details>
		{/key}
	{/if}
</div>
