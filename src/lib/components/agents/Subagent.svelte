<script lang="ts">
	import type { Snippet } from 'svelte';
	import { followSubagent } from '$lib/agents/agents.remote';
	import { foldSteps, type Step } from '$lib/agents/steps';
	import { createMarkdown } from '$lib/markdown';

	/**
	 * What a subagent did, inside its Agent step once that's opened: its steps folded as the
	 * chat's are, what it said between them. Its prompt and its report are the step's own.
	 */
	interface Props {
		repo: string;
		/** the session it's a subagent of */
		id: string;
		/** the Agent call that started it */
		toolUseId: string;
		/** the chat's, so its own subagents open the same way, one level in */
		steps: Snippet<[Step[]]>;
	}

	let { repo, id, toolUseId, steps }: Props = $props();

	const markdown = createMarkdown();
	const live = $derived(followSubagent({ repo, id, toolUseId }));
	const items = $derived(live.current);
	// the prompt's the step's already
	const shown = $derived(foldSteps((items ?? []).filter((i) => i.type !== 'user')));
</script>

{#if items === undefined}
	<p class="px-2.5 text-faint">Reading its conversation…</p>
{:else if items === null}
	<p class="px-2.5 text-faint">No conversation of its own to show</p>
{:else if shown.length}
	<div class="flex flex-col gap-1.5 border-y border-line bg-canvas/50 px-2.5 py-2">
		{#each shown as item, i (i)}
			{#if item.type === 'steps'}
				{@render steps(item.steps)}
			{:else if item.type === 'text' && item.text.trim()}
				<div class="prose text-[12.5px] leading-relaxed break-words">
					{@html markdown.render(item.text)}
				</div>
			{:else if item.type === 'notice'}
				<p class="text-center text-[11px] text-muted">{item.text}</p>
			{/if}
		{/each}
	</div>
{/if}
