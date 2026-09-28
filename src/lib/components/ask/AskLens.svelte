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
	}

	let { threads, files, guide }: Props = $props();

	const thread = $derived(threads.get(threads.open));
	const grouped = $derived(groupThreads(threads.list, files, guide));
	const order = $derived(grouped.flatMap((g) => g.threads));
	const section = $derived(thread ? sectionLabel(guide, thread.anchor.hunk) : undefined);
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
		threads.close();
		await tick();
		reveal(anchor);
	}

	function onkeydown(event: KeyboardEvent) {
		if (!thread) return;
		if (event.key === '.' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			threads.cancel(thread.id);
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if ((event.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
		const at = order.findIndex((t) => t.id === thread.id);
		if (event.key === 'j' || event.key === 'k') {
			const next = order[at + (event.key === 'j' ? 1 : -1)];
			if (next) threads.openLens(next.id);
		} else if (event.key === 'r') {
			document.querySelector<HTMLTextAreaElement>('[data-followup] textarea')?.focus();
		} else if (event.key === 't') {
			threads.toggleTrail();
		} else if (event.key === '\\') {
			flipped = !flipped;
		} else return;
		event.preventDefault();
	}
</script>

{#if thread}
	<dialog
		{@attach (el) => {
			el.showModal();
			return () => el.close();
		}}
		class={['lens', flipped && 'flip']}
		aria-label="Questions to Claude"
		oncancel={(event) => {
			event.preventDefault();
			// esc leaves a box being typed in first, then the lens
			const active = document.activeElement as HTMLElement | null;
			if (active?.matches('textarea, input')) active.blur();
			else threads.close();
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
					onclose={() => threads.close()}
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
	/* under the page header, over everything else; the page behind keeps its scroll */
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
