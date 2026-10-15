<script lang="ts">
	import { MODES, theme, type Mode } from '$lib/theme.svelte';
	import Popover from './Popover.svelte';

	let open = $state(false);
	let themesOpen = $state(false);

	function chooseMode(mode: Mode) {
		theme.setMode(mode);
		open = false;
	}

	function pick(id: string) {
		theme.pick(id);
		open = false;
	}

	const item = (active: boolean) => [
		'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] hover:bg-subtle',
		active ? 'font-medium text-fg' : 'text-muted hover:text-fg'
	];
</script>

{#snippet icon(value: Mode | 'theme' | 'customize')}
	<svg
		viewBox="0 0 16 16"
		class="size-3.5 shrink-0"
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
		{:else if value === 'dark'}
			<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />
		{:else if value === 'theme'}
			<path d="M8 2.25s-4 4.4-4 7.25a4 4 0 0 0 8 0c0-2.85-4-7.25-4-7.25z" />
		{:else}
			<path
				d="M8 2a6 6 0 0 0 0 12c.8 0 1.2-.6 1.2-1.2 0-.9-.7-1.2-.7-2 0-.7.6-1.3 1.3-1.3H11a3 3 0 0 0 3-3C14 4.3 11.3 2 8 2z"
			/>
			<circle cx="5.25" cy="7.5" r=".5" />
			<circle cx="7" cy="5" r=".5" />
			<circle cx="10" cy="5" r=".5" />
		{/if}
	</svg>
{/snippet}

<Popover
	bind:open
	align="end"
	class="w-40 rounded-xl border border-line bg-surface p-1 shadow-float"
>
	{#snippet trigger(props)}
		<button
			{...props}
			class={[
				'grid size-8 place-items-center rounded-lg border bg-control text-muted shadow-raised hover:border-muted hover:text-fg active:shadow-pressed',
				open ? 'border-muted' : 'border-line'
			]}
			title="Theme"
			aria-label="Theme"
		>
			{@render icon(theme.mode)}
		</button>
	{/snippet}
	{#each MODES as option (option.value)}
		<button
			type="button"
			class={item(option.value === theme.mode)}
			aria-pressed={option.value === theme.mode}
			onclick={() => chooseMode(option.value)}
		>
			{@render icon(option.value)}
			{option.label}
		</button>
	{/each}

	<div class="my-1 border-t border-line"></div>

	<!-- light ones, then dark ones, the picked one of each marked -->
	<Popover
		bind:open={themesOpen}
		side="left"
		offset={6}
		class="max-h-[60vh] w-40 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-float"
	>
		{#snippet trigger(props)}
			<button {...props} class={item(themesOpen)}>
				{@render icon('theme')}
				Theme
				<span class="ml-auto truncate text-faint">{theme.find(theme.shown)?.label}</span>
			</button>
		{/snippet}
		{#each theme.sides as { side, label, themes }, i (side)}
			{@const picked = theme.pickedFor(side)}
			<div
				class={[
					'flex items-center gap-1.5 px-2.5 pb-1 text-[10.5px] font-medium tracking-wide text-faint uppercase',
					i ? 'mt-1 border-t border-line pt-2.5' : 'pt-1.5'
				]}
			>
				{@render icon(side)}
				{label}
			</div>
			{#each themes as option (option.id)}
				<button
					type="button"
					class={item(option.id === picked)}
					aria-pressed={option.id === picked}
					onclick={() => pick(option.id)}
				>
					<span class="truncate">{option.label}</span>
				</button>
			{/each}
		{/each}
	</Popover>

	<a href="/theme" class={item(false)} onclick={() => (open = false)}>
		{@render icon('customize')}
		Customize…
	</a>
</Popover>
