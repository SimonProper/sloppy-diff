<script lang="ts">
	import type { Layout } from '$lib/diff/split';
	import type { ChangeMode, ChangeSummary } from '$lib/diff/types';
	import LayoutToggle from './LayoutToggle.svelte';
	import SegmentedControl from './SegmentedControl.svelte';

	interface Props {
		mode: ChangeMode;
		summary: ChangeSummary | null;
		onchange: (mode: ChangeMode) => void;
		layout: Layout;
	}

	let { mode, summary, onchange, layout = $bindable() }: Props = $props();

	const MODES: { value: ChangeMode; label: string; title: string }[] = [
		{ value: 'lines', label: 'Lines', title: 'Whole lines, as git reports them' },
		{
			value: 'tokens',
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
		<LayoutToggle bind:layout />
		<span class="h-3 w-px bg-line"></span>
		<span class="text-[11px] text-faint">Changes</span>
		<SegmentedControl options={MODES} value={mode} {onchange} label="Changes" />
	</div>
</div>
