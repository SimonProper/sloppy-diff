<script lang="ts">
	import type { Layout } from '$lib/diff/split';
	import { remember } from '$lib/prefs';

	let { layout = $bindable() }: { layout: Layout } = $props();

	const OPTIONS: { value: Layout; label: string; title: string }[] = [
		{ value: 'unified', label: 'Unified', title: 'Old and new lines in one column' },
		{ value: 'split', label: 'Split', title: 'Old on the left, new on the right' }
	];

	function choose(value: Layout) {
		layout = value;
		remember('layout', value);
	}
</script>

<div class="flex rounded-lg border border-line bg-surface p-0.5">
	{#each OPTIONS as option (option.value)}
		<button
			type="button"
			title={option.title}
			class={[
				'flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px]',
				layout === option.value ? 'bg-subtle font-medium text-fg' : 'text-muted hover:text-fg'
			]}
			onclick={() => choose(option.value)}
		>
			<svg
				viewBox="0 0 16 16"
				class="size-3.5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linejoin="round"
			>
				<rect x="2" y="3" width="12" height="10" rx="2" />
				{#if option.value === 'split'}
					<path d="M8 3v10" />
				{:else}
					<path d="M4.5 6.5h7M4.5 9.5h7" stroke-linecap="round" />
				{/if}
			</svg>
			{option.label}
		</button>
	{/each}
</div>
