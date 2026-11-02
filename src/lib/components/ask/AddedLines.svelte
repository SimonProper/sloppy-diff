<script lang="ts">
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { Anchor } from '$lib/ask/types';
	import LinesChip from './LinesChip.svelte';

	interface Props {
		threads: Threads;
		/** the chat they go to, '' the new one */
		id: string;
		onjump?: (anchor: Anchor) => void;
	}

	let { threads, id, onjump }: Props = $props();

	const items = $derived(threads.attached[id] ?? []);
</script>

{#if items.length}
	<ul class="flex flex-wrap gap-1.5 pb-2">
		{#each items as item, n (n)}
			<li class="min-w-0">
				<LinesChip anchor={item} {onjump} onremove={() => threads.attached[id].splice(n, 1)} />
			</li>
		{/each}
	</ul>
{/if}
