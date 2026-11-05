<script lang="ts">
	import PillSelect from '$lib/components/PillSelect.svelte';
	import { getModels } from '$lib/agents/agents.remote';
	import { EFFORTS, MODES, type Effort, type Mode } from '$lib/agents/types';

	interface Props {
		repo: string;
		mode: Mode;
		model: string;
		effort: Effort;
		onmode: (mode: Mode) => void;
		onmodel: (model: string) => void;
		oneffort: (effort: Effort) => void;
		/** the composer it's in cycles the mode on ⇧⇥, said in the mode's tooltip */
		shortcut?: boolean;
	}

	let { repo, mode, model, effort, onmode, onmodel, oneffort, shortcut = false }: Props = $props();

	const models = $derived(getModels(repo));
	// the one picked stays a choice while the list loads, or when Claude Code no longer offers it
	const modelOptions = $derived.by(() => {
		const listed = models.current ?? [];
		return listed.some((m) => m.value === model)
			? listed
			: [{ value: model, label: model === 'default' ? 'Default model' : model }, ...listed];
	});
	// the levels the picked model takes, and the one picked even when it doesn't take it
	const levels = $derived(models.current?.find((m) => m.value === model)?.efforts ?? []);
	const effortOptions = $derived(
		EFFORTS.filter((e) => e.value === 'default' || e.value === effort || levels.includes(e.value))
	);
</script>

<PillSelect
	label="Permission mode{shortcut ? ', ⇧⇥ to switch' : ''}"
	options={MODES}
	value={mode}
	onchange={onmode}
/>
<div class="flex items-center gap-1.5">
	<PillSelect label="Model" options={modelOptions} value={model} onchange={onmodel} />
	{#if levels.length}
		<PillSelect label="Effort" options={effortOptions} value={effort} onchange={oneffort} />
	{/if}
</div>
