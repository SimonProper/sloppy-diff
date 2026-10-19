<script lang="ts">
	import { page } from '$app/state';
	import { errorText } from '$lib/errors';
	import { removeComment } from '$lib/pr/pr.remote';
	import { refresh } from '$lib/pr/refresh';
	import type { PrComment } from '$lib/pr/types';
	import Popover from '../Popover.svelte';

	interface Props {
		comment: PrComment;
		/** opens it to edit, without it there's no Edit */
		onedit?: () => void;
	}

	let { comment, onedit }: Props = $props();

	let open = $state(false);
	let deleting = $state(false);
	let failure = $state('');

	const item =
		'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-muted hover:bg-subtle';

	async function remove() {
		open = false;
		const kind = comment.deletable;
		if (!kind) return;
		// a posted comment may have been read already, a draft only you have seen
		if (!comment.pending && !confirm("Delete this comment? This can't be undone.")) return;
		deleting = true;
		failure = '';
		try {
			await removeComment({ repo: page.data.repo, id: comment.id, kind });
			await refresh();
		} catch (e) {
			failure = errorText(e);
		} finally {
			deleting = false;
		}
	}
</script>

<!-- on the comment's hover, like the way to a thread -->
<span class="ml-auto flex shrink-0 items-center gap-2">
	{#if failure}
		<span class="text-del" title={failure}>Couldn't delete</span>
	{/if}
	{#if deleting}
		<span>Deleting…</span>
	{:else}
		<Popover
			bind:open
			align="end"
			offset={4}
			class="w-28 rounded-xl border border-line bg-surface p-1 shadow-float"
		>
			{#snippet trigger(props)}
				<button
					{...props}
					class={[
						'grid size-4 place-items-center rounded-sm hover:text-fg focus-visible:opacity-100',
						!open && !failure && 'opacity-0 group-hover/comment:opacity-100'
					]}
					aria-label="More"
				>
					<svg viewBox="0 0 16 16" class="size-3" fill="currentColor"
						><circle cx="8" cy="3" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle
							cx="8"
							cy="13"
							r="1.4"
						/></svg
					>
				</button>
			{/snippet}
			{#if onedit}
				<button
					type="button"
					class={[item, 'hover:text-fg']}
					onclick={() => {
						open = false;
						onedit();
					}}
				>
					{@render icon('edit')}
					Edit
				</button>
			{/if}
			{#if comment.deletable}
				<button type="button" class={[item, 'hover:text-del']} onclick={remove}>
					{@render icon('delete')}
					Delete
				</button>
			{/if}
		</Popover>
	{/if}
</span>

{#snippet icon(value: 'edit' | 'delete')}
	<svg
		viewBox="0 0 16 16"
		class="size-3.5 shrink-0"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		{#if value === 'edit'}
			<path d="M10.5 2.75l2.75 2.75L5.5 13.25H2.75V10.5z" />
			<path d="M9 4.25l2.75 2.75" />
		{:else}
			<path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5" />
			<path d="M4 4.25l.6 8.4c.05.6.55 1.1 1.15 1.1h4.5c.6 0 1.1-.5 1.15-1.1l.6-8.4" />
		{/if}
	</svg>
{/snippet}
