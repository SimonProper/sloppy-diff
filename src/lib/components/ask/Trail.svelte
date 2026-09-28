<script lang="ts">
	import type { Live } from '$lib/ask/threads.svelte';
	import type { Step } from '$lib/ask/types';

	interface Props {
		steps: Step[];
		/** the answer being written, when it still is */
		live?: Live;
		thinkingMs?: number;
		thinkingTokens?: number;
		/** answered trails start open or folded, the reader's preference */
		preferOpen: boolean;
	}

	let { steps, live, thinkingMs, thinkingTokens = 0, preferOpen }: Props = $props();

	/** set once the reader opens or folds this trail themselves */
	let chosen = $state<boolean | null>(null);
	// while Claude works the trail is the thing to watch, once the answer starts it folds away
	const working = $derived(live !== undefined && !live.text);
	const open = $derived(working || (chosen ?? preferOpen));

	let now = $state(Date.now());
	$effect(() => {
		if (!live) return;
		const timer = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(timer);
	});
	const elapsed = $derived(live ? Math.max(0, Math.round((now - live.startedAt) / 1000)) : 0);

	const reads = $derived(steps.filter((s) => s.type === 'tool' && s.text.startsWith('Reading')));
	const searches = $derived(
		steps.filter((s) => s.type === 'tool' && !s.text.startsWith('Reading'))
	);
	const thought = $derived(thinkingTokens > 0 || steps.some((s) => s.type === 'thinking'));
	const last = $derived(steps.at(-1));

	/** "Thought for 6s · read 3 files · 2 searches" */
	const summary = $derived(
		[
			thought &&
				(thinkingMs ? `Thought for ${Math.max(1, Math.round(thinkingMs / 1000))}s` : 'Thought'),
			reads.length && `read ${reads.length} ${reads.length === 1 ? 'file' : 'files'}`,
			searches.length && `${searches.length} ${searches.length === 1 ? 'search' : 'searches'}`
		]
			.filter(Boolean)
			.join(' · ')
	);

	/** what it's doing right now */
	const current = $derived.by(() => {
		if (!live) return summary;
		if (live.text) return summary || 'Answering';
		if (last?.type === 'tool') return last.text;
		if (last?.type === 'thinking') return 'Thinking';
		return `${live.status}…`;
	});

	const icon = (text: string) =>
		text.startsWith('Reading') ? '◧' : /^(Searching|Looking)/.test(text) ? '⌕' : '›';
</script>

{#if live || steps.length || thinkingTokens}
	<div class="mb-2.5">
		<button
			type="button"
			class="-ml-0.5 flex h-[26px] max-w-full items-center gap-[7px] rounded-md pr-1.5 pl-0.5 text-[12px] text-muted hover:text-fg"
			aria-expanded={open}
			onclick={() => (chosen = !open)}
		>
			{#if working}
				<span
					class="spin size-3 shrink-0 rounded-full border-[1.5px] border-ink-soft/40 border-t-ink"
				></span>
			{:else}
				<svg
					viewBox="0 0 16 16"
					class={['size-3 shrink-0 transition-transform', open && 'rotate-90']}
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="m6 4 4 4-4 4" /></svg
				>
			{/if}
			<span class="truncate">{current}</span>
			{#if working}
				<span class="text-faint tabular-nums">· {elapsed}s</span>
			{/if}
		</button>

		{#if open}
			<ol
				class="unfold mt-1 mb-1 ml-[7px] flex flex-col gap-2 overflow-hidden border-l border-line pl-3.5"
			>
				{#each steps as step, i (i)}
					{@const latest = working && i === steps.length - 1}
					{#if step.type === 'thinking'}
						<li
							class={[
								'text-[12px] leading-[1.55] whitespace-pre-wrap text-muted',
								latest && 'thinking-live'
							]}
						>
							{step.text}
						</li>
					{:else if step.type === 'tool'}
						<li class="flex items-center gap-[7px] font-mono text-[11.5px] text-muted">
							{#if latest}
								<span
									class="spin size-2.5 shrink-0 rounded-full border-[1.5px] border-ink-soft/40 border-t-ink"
								></span>
							{:else}
								<span class="w-3 text-center text-faint">{icon(step.text)}</span>
							{/if}
							<span class="truncate">{step.text}</span>
						</li>
					{:else}
						<li class="text-[12.5px] leading-normal text-muted">{step.text}</li>
					{/if}
				{:else}
					<li class="text-[12px] text-faint">
						{working
							? 'Waiting for the first thought…'
							: `Claude thought for about ${thinkingTokens} tokens, this version of Claude Code doesn't share what.`}
					</li>
				{/each}
			</ol>
		{/if}
	</div>
{/if}

<style>
	.spin {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.unfold {
		animation: unfold 0.15s ease-out;
	}
	@keyframes unfold {
		from {
			opacity: 0;
			transform: translateY(-3px);
		}
	}
	/* the thought being written: its last seven lines, the older ones fading out on top */
	.thinking-live {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		max-height: calc(1.55em * 7);
		overflow: hidden;
		mask-image: linear-gradient(to bottom, transparent, black 2.5em);
	}
</style>
