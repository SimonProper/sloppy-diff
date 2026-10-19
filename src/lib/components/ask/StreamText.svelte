<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { advance, blocks, renderBlock, startReveal } from '$lib/ask/reveal';

	interface Props {
		/** the answer's markdown, as much of it as has arrived */
		text: string;
		/** more of it is on its way */
		streaming: boolean;
		/** the answer as the server rendered it, shown once all of it is on screen */
		html?: string;
		/** what comes after the text, told whether all of it is on screen */
		after?: Snippet<[boolean]>;
	}

	let { text, streaming, html, after }: Props = $props();

	/** how long a word takes to fade in */
	const FADE = 240;

	const reduced =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	// mounted with the stream over, it's an answer loaded with the thread, shown at once
	let reveal = $state.raw(untrack(() => startReveal(text, !streaming)));
	/** the last words have faded in too */
	let faded = $state(untrack(() => !streaming));
	const settled = $derived(
		faded && !streaming && reveal.source === text && reveal.shown === text.length
	);

	// what arrived shows at its own pace, a frame at a time, and the frames stop while
	// there's nothing to show
	$effect(() => {
		const source = text;
		const live = streaming;
		let last = performance.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let frame = requestAnimationFrame(function tick(now) {
			reveal = advance(reveal, source, live, now - last, reduced);
			last = now;
			if (!reveal.idle) frame = requestAnimationFrame(tick);
			else if (!live) timer = setTimeout(() => (faded = true), reduced ? 0 : FADE);
		});
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(timer);
		};
	});

	// a block of its own each, rendered once: a finished block's element stays as it is,
	// selectable, while only the last one grows
	let rendered: { source: string; html: string }[] = [];
	const shown = $derived.by(() => {
		rendered = blocks(reveal.source.slice(0, reveal.shown)).map((source, i) =>
			rendered[i]?.source === source ? rendered[i] : { source, html: renderBlock(source) }
		);
		return rendered;
	});

	let box = $state<HTMLElement>();
	/** the text before this is done fading in */
	let base = 0;
	/** how far the text reached on each update still fading in, and when */
	let fresh: { end: number; time: number }[] = [];

	// New words fade in. The last block is rendered again with each word, so its words still
	// fading are wrapped again each time, their fade picked up where it was. A finished
	// block keeps its own, they finish fading on their own
	$effect(() => {
		void shown;
		if (!box || reduced || settled) return;
		const now = performance.now();
		const length = box.textContent?.length ?? 0;
		if (length < (fresh.at(-1)?.end ?? base)) {
			base = 0;
			fresh = [];
		}
		if (length > (fresh.at(-1)?.end ?? base)) fresh.push({ end: length, time: now });
		while (fresh.length && now - fresh[0].time >= FADE) base = fresh.shift()!.end;
		const last = box.lastElementChild;
		if (!fresh.length || !last) return;

		const texts: [Text, number][] = [];
		const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
		let offset = 0;
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const t = node as Text;
			// a block that didn't change still has its words wrapped
			const wrapped = t.parentElement?.classList.contains('word-enter');
			if (!wrapped && offset + t.length > base && last.contains(t)) texts.push([t, offset]);
			offset += t.length;
		}
		for (const [node, start] of texts) {
			const words = document.createDocumentFragment();
			let at = start;
			for (const part of node.data.split(/(\s+)/)) {
				const time = at >= base && /\S/.test(part) && fresh.find((f) => at < f.end)?.time;
				if (time) {
					const word = document.createElement('span');
					word.className = 'word-enter';
					word.style.animationDelay = `${time - now}ms`;
					word.textContent = part;
					words.append(word);
				} else if (part) words.append(part);
				at += part.length;
			}
			node.replaceWith(words);
		}
	});
</script>

<div bind:this={box} class="answer prose text-[13.5px] leading-relaxed">
	{#if settled && html !== undefined}
		{@html html}
	{:else}
		{#each shown as block, i (i)}{@html block.html}{/each}
	{/if}
</div>
{@render after?.(settled)}

<style>
	.answer :global(.word-enter) {
		animation: word-enter 240ms ease-out both;
	}
	@keyframes word-enter {
		from {
			opacity: 0;
		}
	}
</style>
