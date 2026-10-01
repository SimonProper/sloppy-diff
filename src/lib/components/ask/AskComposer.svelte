<script lang="ts">
	import { untrack } from 'svelte';
	import { sectionLabel, shortLines } from '$lib/ask/groups';
	import { rowOf } from '$lib/ask/rows';
	import { spanLabel } from '$lib/ask/span';
	import type { Threads } from '$lib/ask/threads.svelte';
	import { findHunk } from '$lib/diff/hunks';
	import type { DiffFile } from '$lib/diff/types';
	import { errorText } from '$lib/errors';
	import { commentOn } from '$lib/pr/comment';
	import type { Guide } from '$lib/guide/types';
	import AskField from './AskField.svelte';

	interface Props {
		threads: Threads;
		files: DiffFile[];
		guide?: Guide | null;
	}

	let { threads, files, guide }: Props = $props();

	const draft = $derived(
		threads.composing && !(threads.open && threads.expanded) ? threads.draft : null
	);

	const context = $derived.by(() => {
		if (draft && !draft.span) {
			const name = draft.path?.split('/').pop();
			return name ? `whole file ${name}` : 'whole change';
		}
		const found = draft?.span && findHunk(files, draft.span.hunk);
		if (!draft?.span || !found) return '';
		const { file, hunk } = found;
		const section = sectionLabel(guide, hunk.id);
		return [`${shortLines(spanLabel(hunk, draft.span))} ${file.newPath.split('/').pop()}`, section]
			.filter(Boolean)
			.join(' · ');
	});

	/** where it floats: under the last picked line, lined up with the code */
	let place = $state<{ top: number; left: number; width: number } | null>(null);
	let box = $state<HTMLElement>();

	function measure() {
		if (!draft) return;
		if (!draft.span) {
			// a whole file or the whole change: under the button it was asked from
			const at = draft.at && document.getElementById(draft.at)?.getBoundingClientRect();
			if (!at) {
				place = null;
				return;
			}
			const width = Math.min(460, window.innerWidth - 16);
			const left = Math.max(8, at.right - width);
			place = { top: at.bottom + 6 + window.scrollY, left: left + window.scrollX, width };
			return;
		}
		const { hunk, start, end, side } = draft.span;
		const last = rowOf(hunk, end, side);
		const card = last?.closest('section');
		// its lines scrolled out of a virtualised diff, the draft waits in the controller
		if (!last || !card) {
			place = null;
			return;
		}
		const row = last.getBoundingClientRect();
		const { left: cardLeft, right: edge } = card.getBoundingClientRect();
		// past the line numbers and the +/−, and clear of the markers down the right edge. A
		// unified row scrolls sideways with its hunk, the card doesn't
		const left = side ? row.left + 48 + 20 : cardLeft + 1 + 96 + 20;
		const width = Math.max(260, Math.min(460, edge - 24 - left));
		// its own height, without measuring again whenever it shows up
		const height = untrack(() => box?.offsetHeight) ?? 48;
		let top = row.bottom + 6;
		// no room below: above the first picked line instead
		if (top + height > window.innerHeight - 8) {
			const first = rowOf(hunk, start, side)?.getBoundingClientRect();
			if (first) top = first.top - 6 - height;
		}
		place = { top: top + window.scrollY, left: left + window.scrollX, width };
	}

	$effect(() => {
		if (!draft) return;
		void draft.span;
		measure();
		let frame = 0;
		const later = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		};
		window.addEventListener('scroll', later, { passive: true });
		window.addEventListener('resize', later);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', later);
			window.removeEventListener('resize', later);
		};
	});

	let sending = $state(false);
	let failure = $state('');

	/** on a pull request, what's typed goes to Claude or to your pending review, as picked */
	const choosing = $derived(!!threads.review && !!draft && !!(draft.span || draft.path));
	const commenting = $derived(choosing && threads.intent === 'comment');
	const what = $derived(draft?.span ? 'these lines' : 'this file');

	async function comment(text: string) {
		const suggestion = draft && commentOn(files, draft, text);
		if (!suggestion) return;
		sending = true;
		failure = '';
		try {
			await threads.addToReview(suggestion);
			threads.draft = null;
			threads.composing = false;
		} catch (e) {
			failure = errorText(e);
		} finally {
			sending = false;
		}
	}

	async function send(text: string, background: boolean) {
		if (commenting) return comment(text);
		sending = true;
		failure = '';
		try {
			const id = await threads.ask(text);
			if (!background) threads.openLens(id);
		} catch (e) {
			failure = errorText(e);
		} finally {
			sending = false;
		}
	}
</script>

<svelte:document
	onpointerdown={(event) => {
		// clicking elsewhere puts it away, the draft stays. A line number picks new lines instead
		const target = event.target as HTMLElement;
		if (!draft || box?.contains(target) || target.closest('.gutter')) return;
		threads.composing = false;
	}}
/>

{#if draft && place}
	<div
		bind:this={box}
		popover="manual"
		{@attach (el) => {
			el.showPopover();
			return () => el.hidePopover();
		}}
		class="absolute rounded-[10px] border border-line bg-surface shadow-float"
		style:top="{place.top}px"
		style:left="{place.left}px"
		style:width="{place.width}px"
	>
		{#if choosing}
			<!-- what ↵ does, Tab switches it. Clicking leaves the focus in the text -->
			<div class="flex px-2 pt-2" role="radiogroup" aria-label="Send to">
				<div class="flex rounded-lg border border-line p-0.5">
					{#each [{ intent: 'ask', label: 'Ask Claude' }, { intent: 'comment', label: 'Comment' }] as const as option (option.intent)}
						<button
							type="button"
							role="radio"
							aria-checked={threads.intent === option.intent}
							class={[
								'h-6 rounded-md px-2 text-[11.5px]',
								threads.intent === option.intent
									? 'bg-subtle font-medium text-fg'
									: 'text-muted hover:text-fg'
							]}
							onpointerdown={(e) => e.preventDefault()}
							onclick={() => threads.setIntent(option.intent)}>{option.label}</button
						>
					{/each}
				</div>
			</div>
		{/if}
		<AskField
			bind:value={
				() => threads.draft?.text ?? '',
				(v) => {
					if (threads.draft) threads.draft.text = v;
				}
			}
			bare
			autofocus
			{context}
			placeholder={commenting ? `Comment on ${what}` : 'Ask about these lines'}
			hints={choosing
				? [
						commenting ? 'tab to ask Claude' : 'tab to comment',
						commenting ? '↵ adds it to your review' : '⌘↵ in background'
					]
				: ['esc', '⌘↵ in background']}
			busy={sending}
			action={commenting ? 'Comment' : 'Ask'}
			onsend={send}
			ontab={choosing ? () => threads.setIntent(commenting ? 'ask' : 'comment') : undefined}
			onescape={() => (threads.composing = false)}
		/>
		{#if failure}
			<p class="px-2.5 pb-2 text-[12px] text-del">{failure}</p>
		{/if}
	</div>
{/if}
