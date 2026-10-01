<script lang="ts">
	interface Props {
		/** everything that has arrived so far */
		text: string;
		/** how much of it is on screen, for whoever follows it with the scroll */
		shown?: number;
	}

	let { text, shown = $bindable(0) }: Props = $props();

	const FADE_MS = 400;

	/** text before this has faded in and sits in one plain text node */
	let settled = $state(0);
	/** the pieces still fading in, one per frame that revealed something */
	let fresh = $state<{ start: number; end: number; at: number }[]>([]);

	// reveal what arrived at a pace that speeds up with the backlog, so a burst
	// of text reads as a quick flow rather than a jump, and never falls far behind
	$effect(() => {
		let frame = requestAnimationFrame(function tick(now) {
			if (text.length < shown) {
				shown = settled = 0;
				fresh = [];
			}
			const backlog = text.length - shown;
			if (backlog > 0) {
				const end = shown + Math.max(2, Math.ceil(backlog / 12));
				fresh.push({ start: shown, end: Math.min(end, text.length), at: now });
				shown = Math.min(end, text.length);
			}
			const done = fresh.findIndex((f) => now - f.at < FADE_MS);
			const cut = done === -1 ? fresh.length : done;
			if (cut > 0) {
				settled = fresh[cut - 1].end;
				fresh = fresh.slice(cut);
			}
			frame = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(frame);
	});
</script>

<p class="text-[13.5px] leading-relaxed whitespace-pre-wrap">
	{text.slice(0, settled)}{#each fresh as f (f.start)}<span class="fade"
			>{text.slice(f.start, f.end)}</span
		>{/each}<span class="caret"></span>
</p>

<style>
	.fade {
		animation: fade-in 400ms ease-out both;
	}
	@keyframes fade-in {
		from {
			opacity: 0;
			filter: blur(2px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fade {
			animation: none;
		}
	}
	.caret {
		display: inline-block;
		width: 7px;
		height: 1.05em;
		margin-left: 1px;
		vertical-align: -2px;
		background: var(--ink);
		animation: blink 1s steps(1) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
</style>
