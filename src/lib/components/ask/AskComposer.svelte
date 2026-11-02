<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { untrack } from 'svelte';
	import { sectionLabel, shortLines } from '$lib/ask/groups';
	import { rowOf } from '$lib/ask/rows';
	import { spanLabel } from '$lib/ask/span';
	import type { Threads } from '$lib/ask/threads.svelte';
	import { findHunk } from '$lib/diff/hunks';
	import type { DiffFile } from '$lib/diff/types';
	import { errorText } from '$lib/errors';
	import { commentOn, suggestionFor } from '$lib/pr/comment';
	import { extensionOf } from '$lib/ask/editor';
	import type { Guide } from '$lib/guide/types';
	import AskField from './AskField.svelte';
	import Avatar from '../pr/Avatar.svelte';

	interface Props {
		threads: Threads;
		files: DiffFile[];
		guide?: Guide | null;
	}

	let { threads, files, guide }: Props = $props();

	// a comment on a pull request. Questions to the agent are typed in its panel
	const draft = $derived(
		threads.composing && threads.review && !(threads.open && threads.expanded)
			? threads.draft
			: null
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

	/** where it floats: under the last picked line, lined up with the code, up to the markers on
	 * the right, for a suggestion's lines to wrap as little as the diff's */
	let place = $state<{ top: number; left: number; width: number; cut?: number } | null>(null);
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
		// past the line numbers and the padding, and clear of the markers down the right edge. A
		// unified row scrolls sideways with its hunk, the card doesn't
		const left = side ? row.left + 48 + 12 : cardLeft + 1 + 96 + 12;
		const width = Math.max(260, edge - 24 - left);
		// its own height, without measuring again whenever it shows up
		const height = untrack(() => box?.offsetHeight) ?? 48;
		let top = row.bottom + 6;
		// no room below: above the first picked line instead
		if (top + height > window.innerHeight - 8) {
			const first = rowOf(hunk, start, side)?.getBoundingClientRect();
			if (first) top = first.top - 6 - height;
		}
		// on the top layer it would cover the bars stuck above, so what's under the file's header is cut
		const under = card.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
		const cut = Math.max(0, under - top);
		place = { top: top + window.scrollY, left: left + window.scrollX, width, cut };
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

	const what = $derived(draft?.span ? 'these lines' : 'this file');

	/** at once with `post`, otherwise in your review, the only place it goes while one's in progress */
	async function comment(text: string, post = !threads.review?.pending) {
		const suggestion = draft && commentOn(files, draft, text);
		if (!suggestion) return;
		sending = true;
		failure = '';
		try {
			await threads.comment(suggestion, post);
			threads.draft = null;
			threads.composing = false;
		} catch (e) {
			failure = errorText(e);
		} finally {
			sending = false;
		}
	}

	// the file's extension, for code typed about it
	const language = $derived(
		extensionOf(draft?.span ? findHunk(files, draft.span.hunk)?.file.newPath : draft?.path)
	);

	// the picked lines to change in place, on GitHub's apply button. Not for removed lines
	const suggestion = $derived(draft?.span && suggestionFor(files, draft.span));

	/** esc: the comment is dropped, what's typed and the lines picked for it */
	function abort() {
		threads.draft = null;
		threads.composing = false;
	}

	function suggest() {
		if (!threads.draft || !suggestion) return;
		threads.draft.text = [threads.draft.text.trim(), suggestion].filter(Boolean).join('\n\n');
	}
</script>

{#snippet extra()}
	{#if suggestion && !draft?.text.includes('```suggestion')}
		<!-- the focus stays in the text, its cursor in the block to change the lines in -->
		<Button
			variant="ghost"
			size="xs"
			title="Adds the lines as a suggestion, for them to be changed and applied on GitHub"
			onpointerdown={(event) => event.preventDefault()}
			onclick={suggest}>Suggest a change</Button
		>
	{/if}
	{#if !threads.review?.pending && draft?.text.trim()}
		<Button
			variant="ghost"
			size="xs"
			title="Adds it to a new pending review, only you see it until you finish the review"
			disabled={sending}
			onclick={() => comment(draft?.text.trim() ?? '', false)}>Start a review</Button
		>
	{/if}
{/snippet}

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
		class="absolute rounded-2xl border border-line bg-surface shadow-float"
		style:top="{place.top}px"
		style:left="{place.left}px"
		style:width="{place.width}px"
		style:clip-path={place.cut ? `inset(${place.cut}px -40px -40px -40px)` : null}
		style:visibility={place.cut && place.cut >= (box?.offsetHeight ?? 0) ? 'hidden' : null}
	>
		<!-- you, as beside your comments on the overview, lined up with the first line -->
		<div class="flex items-start">
			<Avatar src={threads.review?.avatar ?? ''} class="mt-[12px] ml-3 size-5" />
			<div class="min-w-0 flex-1">
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
					{language}
					people
					placeholder="Comment on {what}"
					hints={['', threads.review?.pending ? '⌘↵ adds it to your review' : '⌘↵ to comment']}
					busy={sending}
					trailing={extra}
					action="Comment"
					onsend={(text) => comment(text)}
					onescape={abort}
				/>
			</div>
		</div>
		{#if failure}
			<p class="px-2.5 pb-2 text-[12px] text-del">{failure}</p>
		{/if}
	</div>
{/if}
