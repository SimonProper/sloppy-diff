<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { tick } from 'svelte';
	import { groupThreads, sectionLabel } from '$lib/ask/groups';
	import { revealAnchor } from '$lib/ask/rows';
	import { linesOf, type Anchor } from '$lib/ask/types';
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { DiffFile } from '$lib/diff/types';
	import type { Guide } from '$lib/guide/types';
	import { errorText } from '$lib/errors';
	import { extensionOf } from '$lib/ask/editor';
	import AskField from './AskField.svelte';
	import Conversation from './Conversation.svelte';
	import AddedLines from './AddedLines.svelte';
	import HunkExcerpt from './HunkExcerpt.svelte';
	import QuestionList from './QuestionList.svelte';

	interface Props {
		threads: Threads;
		files: DiffFile[];
		/** the guide being read, a chat is labelled by its section */
		guide?: Guide | null;
		/** the docked panel, placed in the page's layout. Otherwise the lens over the whole page */
		docked?: boolean;
		/** shows lines or a file in the diff, where the page isn't on one. Otherwise they're scrolled to where they are */
		onshow?: (anchor: Anchor) => void;
	}

	let { threads, files, guide, docked = false, onshow = revealAnchor }: Props = $props();

	const thread = $derived(threads.get(threads.open));
	const grouped = $derived(groupThreads(threads.list));
	const order = $derived(grouped.flatMap((g) => g.threads));
	const lines = $derived(thread && linesOf(thread.anchor));
	const section = $derived(lines ? sectionLabel(guide, lines.hunk) : undefined);
	const at = $derived(thread ? order.findIndex((t) => t.id === thread.id) : -1);
	const part = $derived(lines && guide?.sections.find((s) => s.hunks.includes(lines.hunk)));
	// docked: the section's title, and under it where the lines are
	const heading = $derived(part ? part.title : thread?.anchor.path || 'Whole change');
	const detail = $derived([section, thread?.anchor.label].filter(Boolean).join(' · '));
	const title = $derived.by(() => {
		if (!thread) return '';
		return part ? `${section} ${part.title}` : thread.anchor.path || 'Whole change';
	});

	/** \ flips the questions pane: hidden where there's room for it, shown over the excerpt where not */
	let flipped = $state(false);

	// an answer is read once it's on screen, the marker's dot goes hollow
	$effect(() => {
		if (thread && !threads.live[thread.id]) threads.markSeen(thread);
	});

	async function showInDiff() {
		if (thread) await jumpTo(thread.anchor);
	}

	/** Shows lines in the diff, or a file, leaving the expanded view for it. */
	async function jumpTo(anchor: Anchor) {
		threads.expanded = false;
		await tick();
		onshow(anchor);
	}

	/** Opens the next or previous question, in the order of the questions list. */
	function step(by: 1 | -1) {
		const next = order[at + by];
		if (next) threads.openLens(next.id);
	}

	let starting = $state(false);
	let failure = $state('');

	/** the lines and files added to the new chat, it's about the whole change without any */
	const adding = $derived(threads.attached[''] ?? []);

	/** A new chat from under the list. With `blast`, the blast radius of its lines instead of `text`. */
	async function startChat(text: string, blast = false) {
		starting = true;
		failure = '';
		try {
			const id = await threads.ask(text, undefined, { blast });
			threads.openLens(id);
		} catch (e) {
			failure = errorText(e);
		} finally {
			starting = false;
		}
	}

	function onkeydown(event: KeyboardEvent) {
		const field = (event.target as HTMLElement).closest('input, textarea, [contenteditable]');
		// docked, esc leaves a box being typed in first, then the panel. The lens has its own
		if (event.key === 'Escape' && !threads.expanded) {
			event.preventDefault();
			if (field) (field as HTMLElement).blur();
			else threads.close();
			return;
		}
		if (!thread) return;
		if (event.key === '.' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			threads.cancel(thread.id);
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey || field) return;
		if (threads.expanded && (event.key === 'j' || event.key === 'k')) {
			step(event.key === 'j' ? 1 : -1);
		} else if (event.key === 'r') {
			document
				.querySelector<HTMLElement>('[data-followup] [contenteditable]')
				?.focus({ preventScroll: true });
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

<!-- for lines alone, nothing typed: what else they affect -->
{#snippet blastRadius()}
	<Button
		variant="ghost"
		size="xs"
		title="What else this change affects: where the compiler finds it used, judged by the agent"
		disabled={starting}
		onclick={() => startChat('', true)}>Blast radius</Button
	>
{/snippet}

{#snippet closeButton()}
	<Button
		variant="ghost"
		icon
		title="Close  esc"
		aria-label="Close the agent panel"
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
	</Button>
{/snippet}

{#if docked && !threads.expanded}
	<!-- a column beside the diff, which stands in for the excerpt and stays usable around it -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<aside data-ask-dock class="dock" aria-label="Agent" {onkeydown}>
		{#if thread}
			{#key thread.id}
				<Conversation
					{threads}
					{thread}
					title={heading}
					{detail}
					onreveal={thread.outdated || !thread.anchor.path ? undefined : showInDiff}
					onjump={jumpTo}
				>
					{#snippet leading()}
						<Button
							variant="ghost"
							icon
							class="-ml-1.5"
							title="All chats"
							aria-label="Back to all chats"
							onclick={() => threads.back()}
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
						</Button>
					{/snippet}
					{#snippet actions()}
						<Button
							variant="ghost"
							icon
							title="Every chat, with the lines beside it  e"
							aria-label="Open the chats view"
							onclick={() => (threads.expanded = true)}
						>
							<svg
								viewBox="0 0 16 16"
								class="size-3.5"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M9.5 3H13v3.5M6.5 13H3V9.5M13 3 9 7M3 13l4-4" /></svg
							>
						</Button>
						{@render closeButton()}
					{/snippet}
				</Conversation>
			{/key}
		{:else}
			<QuestionList {threads} {grouped} actions={closeButton}>
				<!-- a new chat, about lines picked in the diff or the whole change -->
				<div class="shrink-0 px-2 pt-1 pb-2" data-ask-field>
					<AddedLines {threads} id="" onjump={jumpTo} />
					<AskField
						bind:value={threads.newChat}
						placeholder={adding.length ? 'Ask about these' : 'Ask about the whole change'}
						hints={['', '⌘↵ to ask']}
						busy={starting}
						autofocus
						language={extensionOf(adding[0]?.path)}
						trailing={adding[0]?.hunk !== undefined && !threads.newChat.trim()
							? blastRadius
							: undefined}
						onsend={(text) => startChat(text)}
					/>
					{#if failure}
						<p class="px-2.5 pt-1.5 text-[12px] text-del">{failure}</p>
					{/if}
				</div>
			</QuestionList>
		{/if}
	</aside>
{:else if !docked && thread && threads.expanded}
	<dialog
		{@attach (el) => {
			el.showModal();
			return () => el.close();
		}}
		class={['lens', flipped && 'flip']}
		aria-label="Questions to AI"
		oncancel={(event) => {
			event.preventDefault();
			// esc leaves a box being typed in first, then the lens for the docked panel
			const active = document.activeElement as HTMLElement | null;
			if (active?.matches('textarea, input, [contenteditable]')) active.blur();
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
					<Conversation {threads} {thread} {title} onjump={jumpTo} />
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
