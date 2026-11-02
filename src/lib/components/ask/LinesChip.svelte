<script lang="ts">
	import { shortLines } from '$lib/ask/groups';
	import type { Anchor } from '$lib/ask/types';

	interface Props {
		/** lines added to a chat from the diff */
		anchor: Anchor;
		/** shows them in the diff */
		onjump?: (anchor: Anchor) => void;
		/** before they're sent, takes them out again */
		onremove?: () => void;
	}

	let { anchor, onjump, onremove }: Props = $props();
</script>

<span
	class="inline-flex h-6 max-w-full min-w-0 items-center gap-0.5 rounded-full border border-line text-[11px] text-muted"
>
	<button
		type="button"
		class={['min-w-0 truncate pl-2.5 tabular-nums hover:text-fg', onremove ? 'pr-0.5' : 'pr-2.5']}
		title="Show {anchor.label} of {anchor.path} in the diff"
		onclick={() => onjump?.(anchor)}
		>{shortLines(anchor.label)} {anchor.path.split('/').pop()}</button
	>
	{#if onremove}
		<button
			type="button"
			class="mr-1 grid size-4 shrink-0 place-items-center rounded-full hover:bg-subtle hover:text-fg"
			aria-label="Remove {anchor.label} of {anchor.path}"
			onclick={onremove}>×</button
		>
	{/if}
</span>
