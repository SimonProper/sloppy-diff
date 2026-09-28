<script lang="ts">
	let { additions, deletions }: { additions: number; deletions: number } = $props();

	// five blocks like GitHub: small changes fill fewer blocks
	const blocks = $derived.by(() => {
		const total = additions + deletions;
		const filled = Math.min(5, total);
		const added = total === 0 ? 0 : Math.round((filled * additions) / total);
		return Array.from({ length: 5 }, (_, i) => (i < added ? 'add' : i < filled ? 'del' : 'none'));
	});
</script>

<span class="flex gap-px" aria-hidden="true">
	{#each blocks as kind, i (i)}
		<span
			class={[
				'size-[7px] rounded-[2px]',
				kind === 'add' && 'bg-add',
				kind === 'del' && 'bg-del',
				kind === 'none' && 'bg-line'
			]}
		></span>
	{/each}
</span>
