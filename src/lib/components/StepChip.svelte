<script lang="ts">
	export interface Step {
		n: number;
		title: string;
		/** the file in that step, or the step itself once it's reviewed and folded away */
		href: string;
		done: boolean;
	}

	let { n, title, href, done }: Step = $props();
</script>

<!-- another step a file is read in, numbered and ticked like the guide's sidebar -->
<a
	{href}
	class={[
		'grid size-4 shrink-0 place-items-center rounded-full border text-[9.5px] font-medium tabular-nums',
		done
			? 'border-add bg-add text-surface hover:opacity-80'
			: 'border-line text-muted hover:border-muted hover:text-fg'
	]}
	title="Step {n}: {title}{done ? ', reviewed' : ''}"
	aria-label="Also in step {n}: {title}"
>
	{#if done}
		<svg
			viewBox="0 0 16 16"
			class="size-2"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg
		>
	{:else}
		{n}
	{/if}
</a>
