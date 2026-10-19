<script lang="ts">
	import type { Layout } from '$lib/diff/split';
	import type { ChangeMode, ChangeSummary } from '$lib/diff/types';
	import { remember } from '$lib/prefs';
	import LayoutToggle from './LayoutToggle.svelte';
	import Popover from './Popover.svelte';
	import SegmentedControl from './SegmentedControl.svelte';

	interface Props {
		mode: ChangeMode;
		summary: ChangeSummary | null;
		onchange: (mode: ChangeMode) => void;
		layout: Layout;
		width: 'max' | 'full';
	}

	let { mode, summary, onchange, layout = $bindable(), width = $bindable() }: Props = $props();

	let open = $state(false);

	// what each shows says itself on hover
	const MODES = $derived<{ value: ChangeMode; label: string; title: string }[]>([
		{ value: 'lines', label: 'Lines', title: 'Whole lines, as git reports them' },
		{
			value: 'tokens',
			label: 'Tokens',
			title: `Highlight the changed tokens inside lines, and find reformatted code${
				summary?.formattingOnly ? `. ${summary.formattingOnly} formatting only` : ''
			}`
		}
	]);

	const WIDTHS: { value: 'max' | 'full'; label: string; title: string }[] = [
		{ value: 'max', label: 'Max', title: 'Centred, as wide as a 100-column line' },
		{ value: 'full', label: 'Full', title: 'As wide as the window' }
	];

	function chooseWidth(value: 'max' | 'full') {
		width = value;
		remember('width', value);
	}
</script>

<Popover bind:open align="end" class="rounded-xl border border-line bg-surface p-3 shadow-float">
	{#snippet trigger(props)}
		<button
			{...props}
			class={[
				'flex h-7 items-center gap-1.5 rounded-lg border bg-control px-2.5 text-[12px] text-muted shadow-raised hover:border-muted hover:text-fg active:shadow-pressed',
				open ? 'border-muted text-fg' : 'border-line'
			]}
		>
			<svg
				viewBox="0 0 16 16"
				class="size-3.5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				><path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" /><circle
					cx="10"
					cy="4.5"
					r="1.5"
				/><circle cx="6" cy="11.5" r="1.5" /></svg
			>
			View
		</button>
	{/snippet}
	<!-- a grid inside: on the popover itself it would override the hiding while closed -->
	<div class="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-2">
		<span class="text-[11.5px] text-muted">Layout</span>
		<LayoutToggle bind:layout />
		<span class="text-[11.5px] text-muted">Width</span>
		<SegmentedControl options={WIDTHS} value={width} onchange={chooseWidth} label="Width" />
		<span class="text-[11.5px] text-muted">Changes</span>
		<SegmentedControl options={MODES} value={mode} {onchange} label="Changes" />
	</div>
</Popover>
