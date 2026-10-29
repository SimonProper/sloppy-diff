<script lang="ts">
	import { guideJob } from '$lib/guide/job.svelte';
	import HL from '$lib/hairline/kernel.js';
	import sorter from '$lib/hairline/sorter.js';
	import ToolText from './ToolText.svelte';

	/** what the drawing is filled with, the colour of what it stands on */
	let { plate = 'var(--canvas)' }: { plate?: string } = $props();

	const tools = $derived(guideJob.progress?.tools.slice(-6) ?? []);

	/**
	 * where on the drawing the monitor's screen is, in viewBox units: its top-left corner, the width
	 * and height of the text standing there, and the slope it's skewed to, in degrees
	 */
	let screen = $state<number[] | null>(null);

	function figure(stage: HTMLElement) {
		HL.inject(document);
		const svg = HL.mk('svg', { viewBox: '0 0 400 320', 'aria-hidden': 'true' }, stage);
		const handle = sorter.mount({ stage, svg, read: { textContent: '' } }, sorter.range[1]);
		screen = handle.screen;
		return () => {
			handle.destroy();
			svg.remove();
		};
	}
</script>

<!-- the agent at its terminal, sorting the change into sections, what it's on written on its screen -->
<div class="flex flex-col gap-1">
	<div
		data-hairline="sorter"
		style:--hairline-plate={plate}
		style="--hairline-hi: var(--accent); --hairline-edge: var(--muted); --hairline-mid: var(--faint); --hairline-lo: var(--line)"
		{@attach figure}
	>
		{#if screen}
			<!-- only what it's on goes on the screen, short enough to read on the slant -->
			<p
				class="absolute z-10 line-clamp-3 origin-top-left px-1 text-left text-[13px] leading-snug font-medium"
				style:left="{screen[0] / 4}%"
				style:top="{screen[1] / 3.2}%"
				style:width="{screen[2] / 4}%"
				style:transform="skewY({screen[4]}deg)"
				role="status"
				aria-live="polite"
			>
				{guideJob.progress?.status || 'Starting the agent…'}<span
					class="ml-0.5 animate-pulse text-accent"
					aria-hidden="true">▍</span
				>
			</p>
		{/if}
	</div>
	<p class="text-center font-mono text-[11px] text-faint">
		{guideJob.start.slice(0, 7)}..{guideJob.stop.slice(0, 7)} · {guideJob.commits}
		{guideJob.commits === 1 ? 'commit' : 'commits'}
	</p>
	<!-- the detail, flat and readable: what the agent looked at, latest last -->
	{#if tools.length}
		<ul
			class="mt-2 flex h-36 flex-col justify-end gap-0.5 overflow-hidden rounded-xl border border-line bg-subtle/60 px-3 py-2.5 text-left"
		>
			{#each tools as tool, i (i)}
				<li
					class={[
						'truncate font-mono text-[11px]',
						i === tools.length - 1 ? 'text-fg' : 'text-muted'
					]}
				>
					<ToolText text={tool} />
				</li>
			{/each}
		</ul>
	{/if}
</div>
