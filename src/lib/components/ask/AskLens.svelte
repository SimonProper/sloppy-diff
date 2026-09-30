<script lang="ts">
	import { tick } from 'svelte';
	import { groupThreads, sectionLabel } from '$lib/ask/groups';
	import { reveal } from '$lib/ask/rows';
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { DiffFile } from '$lib/diff/types';
	import type { Guide } from '$lib/guide/types';
	import Conversation from './Conversation.svelte';
	import HunkExcerpt from './HunkExcerpt.svelte';
	import QuestionList from './QuestionList.svelte';

	interface Props {
		threads: Threads;
		files: DiffFile[];
		/** the guide being read, questions are grouped and labelled by its sections */
		guide?: Guide | null;
		/** the docked panel, placed in the page's layout. Otherwise the lens over the whole page */
		docked?: boolean;
	}

	let { threads, files, guide, docked = false }: Props = $props();

	const thread = $derived(threads.get(threads.open));
	const grouped = $derived(groupThreads(threads.list, files, guide));
	const order = $derived(grouped.flatMap((g) => g.threads));
	const section = $derived(thread ? sectionLabel(guide, thread.anchor.hunk) : undefined);
	const at = $derived(thread ? order.findIndex((t) => t.id === thread.id) : -1);
	const part = $derived(
		thread && guide?.sections.find((s) => s.hunks.includes(thread.anchor.hunk))
	);
	// docked: the section's title, and under it where the lines are and which question this is
	const heading = $derived(part ? part.title : (thread?.anchor.path ?? ''));
	const detail = $derived(
		[section, thread?.anchor.label, order.length > 1 && `${at + 1} of ${order.length}`]
			.filter(Boolean)
			.join(' · ')
	);
	const title = $derived.by(() => {
		if (!thread) return '';
		const part = guide?.sections.find((s) => s.hunks.includes(thread.anchor.hunk));
		return part ? `${section} ${part.title}` : thread.anchor.path;
	});

	/** \ flips the questions pane: hidden where there's room for it, shown over the excerpt where not */
	let flipped = $state(false);

	// an answer is read once it's on screen, the marker's dot goes hollow
	$effect(() => {
		if (thread && !threads.live[thread.id]) threads.markSeen(thread);
	});

	async function showInDiff() {
		if (!thread) return;
		const anchor = thread.anchor;
		threads.expanded = false;
		await tick();
		reveal(anchor);
	}

	/** Opens the next or previous question, in the order of the questions list. */
	function step(by: 1 | -1) {
		const next = order[at + by];
		if (!next) return;
		threads.openLens(next.id);
		// docked, the diff is the excerpt: it goes to the next question's lines
		if (!threads.expanded) reveal(next.anchor);
	}

	// ⇧J and ⇧K step through the questions from the diff too, where j and k are the guide's
	function onwindowkeydown(event: KeyboardEvent) {
		if (!docked || !thread || threads.expanded) return;
		if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
		if ((event.target as HTMLElement).closest('input, textarea, [contenteditable], dialog')) return;
		if (event.key !== 'J' && event.key !== 'K') return;
		event.preventDefault();
		step(event.key === 'J' ? 1 : -1);
	}

	function onkeydown(event: KeyboardEvent) {
		if (!thread) return;
		if (event.key === '.' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			threads.cancel(thread.id);
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const field = (event.target as HTMLElement).closest('input, textarea, [contenteditable]');
		// docked, esc leaves a box being typed in first, then the panel. The lens has its own
		if (event.key === 'Escape' && !threads.expanded) {
			event.preventDefault();
			if (field) (field as HTMLElement).blur();
			else threads.close();
			return;
		}
		if (field) return;
		if (event.key === 'j' || event.key === 'k') {
			step(event.key === 'j' ? 1 : -1);
		} else if (event.key === 'r') {
			document.querySelector<HTMLTextAreaElement>('[data-followup] textarea')?.focus();
		} else if (event.key === 't') {
			threads.toggleTrail();
		} else if (event.key === 'e') {
			threads.expanded = !threads.expanded;
		} else if (event.key === '\\') {
			flipped = !flipped;
		} else return;
		event.preventDefault();
	}
</script>

<svelte:window onkeydown={onwindowkeydown} />

{#if docked && thread && !threads.expanded}
	<!-- a column beside the diff, which stands in for the excerpt and stays usable around it -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<aside data-ask-dock class="dock" aria-label="Question to Claude" {onkeydown}>
		{#key thread.id}
			<Conversation
				{threads}
				{thread}
				title={heading}
				{detail}
				onreveal={thread.outdated ? undefined : showInDiff}
			>
				{#snippet leading()}
					{#if order.length > 1}
						<span class="-ml-1.5 flex shrink-0 items-center text-muted">
							<button
								type="button"
								class="grid size-7 place-items-center rounded-md hover:bg-subtle hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
								title="Previous question  ⇧K"
								aria-label="Previous question"
								disabled={at <= 0}
								onclick={() => step(-1)}
							>
								<svg
									viewBox="0 0 16 16"
									class="size-3.5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.75"
									stroke-linecap="round"
									stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg
								>
							</button>
							<button
								type="button"
								class="grid size-7 place-items-center rounded-md hover:bg-subtle hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
								title="Next question  ⇧J"
								aria-label="Next question"
								disabled={at >= order.length - 1}
								onclick={() => step(1)}
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
						</span>
					{/if}
				{/snippet}
				{#snippet actions()}
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg"
						title="Every question, with the lines beside it  e"
						aria-label="Open the questions view"
						onclick={() => (threads.expanded = true)}
					>
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M9.5 3H13v3.5M6.5 13H3V9.5M13 3 9 7M3 13l4-4" /></svg
						>
					</button>
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-subtle hover:text-fg"
						title="Close  esc"
						aria-label="Close the question"
						onclick={() => threads.close()}
					>
						<svg
							viewBox="0 0 16 16"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg
						>
					</button>
				{/snippet}
			</Conversation>
		{/key}
	</aside>
{:else if !docked && thread && threads.expanded}
	<dialog
		{@attach (el) => {
			el.showModal();
			return () => el.close();
		}}
		class={['lens', flipped && 'flip']}
		aria-label="Questions to Claude"
		oncancel={(event) => {
			event.preventDefault();
			// esc leaves a box being typed in first, then the lens for the docked panel
			const active = document.activeElement as HTMLElement | null;
			if (active?.matches('textarea, input')) active.blur();
			else threads.expanded = false;
		}}
		{onkeydown}
	>
		<div class="shell">
			<div class="pane list"><QuestionList {threads} {grouped} /></div>
			<div class="pane excerpt">
				<HunkExcerpt
					{thread}
					{files}
					{section}
					onclose={() => (threads.expanded = false)}
					onreveal={showInDiff}
				/>
			</div>
			<div class="pane conversation">
				{#key thread.id}
					<Conversation {threads} {thread} {title} />
				{/key}
			</div>
		</div>
	</dialog>
{/if}

<style>
	.dock {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.dock > :global(section) {
		flex: 1;
	}

	/* expanded: under the page header, over everything else; the page behind keeps its scroll */
	.lens {
		position: fixed;
		inset: 3rem 0 0 0;
		width: 100%;
		max-width: none;
		height: auto;
		max-height: none;
		margin: 0;
		padding: 0;
		border: 0;
		border-top: 1px solid var(--line);
		background: var(--canvas);
		color: var(--fg);
		container: lens / inline-size;
	}
	.lens::backdrop {
		background: transparent;
	}

	/* the shell only arranges the panes, each has its own header and scrolls by itself,
	   so a panel docked beside the diff could stack them without changing them */
	.shell {
		position: relative;
		height: 100%;
		display: grid;
		grid-template: 'list excerpt conversation' minmax(0, 1fr) / 248px minmax(0, 1fr) clamp(
				440px,
				45%,
				680px
			);
	}
	.pane {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.pane > :global(*) {
		flex: 1;
	}
	.list {
		grid-area: list;
		border-right: 1px solid var(--line);
	}
	.excerpt {
		grid-area: excerpt;
	}
	.conversation {
		grid-area: conversation;
		border-left: 1px solid var(--line);
	}
	.flip .shell {
		grid-template-columns: 0 minmax(0, 1fr) clamp(440px, 45%, 680px);
	}
	.flip .list {
		display: none;
	}

	/* narrower: the list goes, and \ brings it back over the excerpt */
	@container lens (max-width: 1100px) {
		.shell,
		.flip .shell {
			grid-template-columns: 0 minmax(0, 1fr) clamp(400px, 50%, 640px);
		}
		.list {
			display: none;
		}
		.flip .list {
			display: flex;
			position: absolute;
			inset: 0 auto 0 0;
			z-index: 3;
			width: 272px;
			box-shadow: var(--float);
		}
	}
	/* narrower still: the excerpt above the conversation */
	@container lens (max-width: 800px) {
		.shell,
		.flip .shell {
			grid-template:
				'excerpt' 40%
				'conversation' minmax(0, 1fr)
				/ minmax(0, 1fr);
		}
		.conversation {
			border-left: 0;
			border-top: 1px solid var(--line);
		}
	}
</style>
