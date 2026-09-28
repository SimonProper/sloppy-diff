<script lang="ts">
	import type { Layout } from '$lib/diff/split';
	import type { ChangeMode } from '$lib/diff/types';
	import LayoutToggle from './LayoutToggle.svelte';

	interface Summary {
		mode: ChangeMode;
		formattingOnly: number;
	}

	interface Props {
		mode: ChangeMode;
		summary: Summary | null;
		onchange: (mode: ChangeMode) => void;
		layout: Layout;
	}

	let { mode, summary, onchange, layout = $bindable() }: Props = $props();

	const MODES: { mode: ChangeMode; label: string; title: string }[] = [
		{ mode: 'lines', label: 'Lines', title: 'Whole lines, as git reports them' },
		{
			mode: 'tokens',
			label: 'Tokens',
			title: 'Highlight the changed tokens inside lines, and find reformatted code'
		}
	];
</script>

<div class="flex items-center justify-between gap-4 px-1">
	<p class="min-w-0 truncate text-[11.5px] text-faint">
		{#if mode === 'lines'}
			Whole lines, as git reports them
		{:else}
			Changed tokens within lines
			{#if summary?.formattingOnly}
				· <span class="text-mod">{summary.formattingOnly} formatting only</span>
			{/if}
		{/if}
	</p>

	<div class="flex shrink-0 items-center gap-2">
		<a
			href="/smoke"
			class="text-[11px] text-faint hover:text-accent"
			title="See both modes side by side on a test repo">Compare modes</a
		>
		<span class="h-3 w-px bg-line"></span>
		<LayoutToggle bind:layout />
		<span class="h-3 w-px bg-line"></span>
		<span class="text-[11px] text-faint">Changes</span>
		<div class="flex rounded-lg border border-line bg-surface p-0.5">
			{#each MODES as m (m.mode)}
				<button
					type="button"
					title={m.title}
					class={[
						'h-6 rounded-md px-2.5 text-[12px]',
						mode === m.mode ? 'bg-subtle font-medium text-fg' : 'text-muted hover:text-fg'
					]}
					onclick={() => onchange(m.mode)}>{m.label}</button
				>
			{/each}
		</div>
	</div>
</div>
