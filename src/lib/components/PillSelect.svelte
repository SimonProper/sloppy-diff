<script lang="ts" generics="T extends string">
	/** A native select drawn as a pill, AgentPicker's look, for a choice that takes no room. */
	interface Props {
		options: { value: T; label: string; title?: string }[];
		value: T;
		onchange: (value: T) => void;
		/** names it for screen readers, and its tooltip */
		label: string;
		disabled?: boolean;
	}

	let { options, value, onchange, label, disabled = false }: Props = $props();

	const current = $derived(options.find((o) => o.value === value));
</script>

<div class="relative shrink-0">
	<!-- picked by its option rather than the select's value: the options can come after it,
	     a list still loading, and the select would show whichever is first -->
	<select
		{disabled}
		aria-label={label}
		title={current?.title ? `${label}: ${current.title}` : label}
		onchange={(e) => onchange(e.currentTarget.value as T)}
		class="field-sizing-content h-6 max-w-40 appearance-none rounded-full border border-line bg-control pr-6 pl-2.5 text-[11.5px] text-muted hover:border-muted hover:text-fg focus:border-accent focus:outline-none disabled:opacity-50"
	>
		{#each options as option (option.value)}
			<option value={option.value} title={option.title} selected={option.value === value}
				>{option.label}</option
			>
		{/each}
	</select>
	<svg
		viewBox="0 0 16 16"
		class="pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2 text-muted"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"><path d="m4.5 6.5 3.5 3 3.5-3" /></svg
	>
</div>
