<script lang="ts">
	import { onMount } from 'svelte';
	import { AGENT_PROVIDERS, type AgentProvider } from '$lib/agent';
	import { getAgentProvider, setAgentProvider } from '$lib/agent.remote';
	import { errorText } from '$lib/errors';

	let selected = $state<AgentProvider | ''>('');
	let loading = $state(true);
	let saving = $state(false);
	let failure = $state('');
	let retryProvider = $state<AgentProvider | null>(null);
	let closed = false;
	const id = $props.id();

	async function load() {
		loading = true;
		failure = '';
		retryProvider = null;
		try {
			const query = getAgentProvider();
			await query.refresh();
			const provider = await query;
			if (!closed) selected = provider;
		} catch (e) {
			if (!closed) failure = `Could not load the AI provider: ${errorText(e)}`;
		} finally {
			if (!closed) loading = false;
		}
	}

	onMount(() => {
		void load();
		return () => {
			closed = true;
		};
	});

	async function save(provider: AgentProvider) {
		if (loading || saving) return;
		const previous = selected;
		selected = provider;
		saving = true;
		failure = '';
		retryProvider = null;
		try {
			const saved = await setAgentProvider(provider);
			if (!closed) selected = saved;
		} catch (e) {
			if (!closed) {
				selected = previous;
				retryProvider = provider;
				failure = `Could not save the AI provider: ${errorText(e)}`;
			}
		} finally {
			if (!closed) saving = false;
		}
	}

	function change(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (value === 'claude' || value === 'codex') void save(value);
	}
</script>

<div class="relative flex shrink-0 items-center gap-1.5" aria-busy={loading || saving}>
	<label for={id} class="text-[11px] text-faint">AI<span class="sr-only"> provider</span></label>
	<div class="relative">
		<select
			{id}
			value={selected}
			onchange={change}
			disabled={loading || saving}
			title="AI provider for new questions, guides, and explainers. Existing conversations keep their agent."
			class="h-7 max-w-32 appearance-none rounded-lg border border-line bg-control pr-7 pl-2 text-[11.5px] text-muted shadow-raised hover:border-muted hover:text-fg focus:border-accent focus:outline-none disabled:opacity-50"
		>
			{#if selected === ''}
				<option value="">{loading ? 'Loading…' : 'Choose AI…'}</option>
			{/if}
			{#each AGENT_PROVIDERS as provider (provider.value)}
				<option value={provider.value}>{provider.label}</option>
			{/each}
		</select>
		<svg
			viewBox="0 0 16 16"
			class="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-muted"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"><path d="m4.5 6.5 3.5 3 3.5-3" /></svg
		>
	</div>
	<span class="sr-only" role="status">{saving ? 'Saving AI provider…' : ''}</span>
	{#if failure}
		<div
			class="absolute top-full right-0 z-30 mt-2 w-72 rounded-lg border border-line bg-surface px-3 py-2.5 text-[11.5px] shadow-float"
			role="alert"
		>
			<p class="break-words text-del">{failure}</p>
			<div class="mt-2 flex items-center gap-3 text-muted">
				<button
					type="button"
					class="font-medium hover:text-fg"
					onclick={() => (retryProvider ? save(retryProvider) : load())}>Try again</button
				>
				<button type="button" class="hover:text-fg" onclick={() => (failure = '')}>Dismiss</button>
			</div>
		</div>
	{/if}
</div>
