<script lang="ts">
	import { readText, writeText } from '$lib/storage';
	import Popover from './Popover.svelte';

	type Theme = 'system' | 'light' | 'dark';

	// app.html reads the same key before first paint
	const KEY = 'sloppy-diff:theme';

	const OPTIONS: { value: Theme; label: string }[] = [
		{ value: 'system', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];

	let theme = $state((readText(KEY) as Theme | null) ?? 'system');
	let open = $state(false);

	function choose(value: Theme) {
		theme = value;
		open = false;
		writeText(KEY, value === 'system' ? null : value);
		const dark =
			value === 'dark' ||
			(value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.classList.toggle('dark', dark);
	}
</script>

{#snippet icon(value: Theme)}
	<svg
		viewBox="0 0 16 16"
		class="size-3.5"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		{#if value === 'system'}
			<rect x="2" y="3" width="12" height="8" rx="1.5" />
			<path d="M6 13.5h4" />
		{:else if value === 'light'}
			<circle cx="8" cy="8" r="2.75" />
			<path
				d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05"
			/>
		{:else}
			<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />
		{/if}
	</svg>
{/snippet}

<Popover
	bind:open
	align="end"
	class="w-32 rounded-xl border border-line bg-surface p-1 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.25)]"
>
	{#snippet trigger(props)}
		<button
			{...props}
			class={[
				'grid size-8 place-items-center rounded-lg border bg-surface text-muted hover:border-muted hover:text-fg',
				open ? 'border-muted' : 'border-line'
			]}
			title="Theme"
			aria-label="Theme"
		>
			{@render icon(theme)}
		</button>
	{/snippet}
	{#each OPTIONS as option (option.value)}
		{@const active = option.value === theme}
		<button
			type="button"
			class={[
				'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] hover:bg-subtle',
				active ? 'font-medium text-fg' : 'text-muted hover:text-fg'
			]}
			aria-pressed={active}
			onclick={() => choose(option.value)}
		>
			{@render icon(option.value)}
			{option.label}
		</button>
	{/each}
</Popover>
