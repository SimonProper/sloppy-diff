<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { page } from '$app/state';
	import { errorText } from '$lib/errors';
	import { changePr, updatePrBranch } from '$lib/pr/pr.remote';
	import { refresh } from '$lib/pr/refresh';
	import type { PullRequest } from '$lib/pr/types';
	import Popover from '../Popover.svelte';

	interface Props {
		pr: PullRequest;
		/** the merge panel open, under the card */
		merging?: boolean;
	}

	let { pr, merging = $bindable(false) }: Props = $props();

	let menu = $state(false);
	/** what's being done, in its button's place */
	let busy = $state<string | null>(null);
	let failure = $state('');

	const open = $derived(pr.state === 'OPEN');

	async function run(doing: string, task: () => Promise<unknown>) {
		menu = false;
		busy = doing;
		failure = '';
		try {
			await task();
			await refresh();
		} catch (e) {
			failure = errorText(e);
		} finally {
			busy = null;
		}
	}

	const repo = () => page.data.repo as string;
	const change = (doing: string, kind: 'close' | 'reopen' | 'ready' | 'draft') =>
		run(doing, () => changePr({ repo: repo(), number: pr.number, pr: pr.id, change: kind }));
	const update = () =>
		run('Updating…', () =>
			updatePrBranch({ repo: repo(), number: pr.number, pr: pr.id, head: pr.headRefOid })
		);
	const item =
		'flex w-full items-center rounded-xl px-2.5 py-1.5 text-left text-[12px] text-muted hover:bg-subtle';
	const updatable = $derived(open && pr.canUpdateBranch && !!pr.behind);
</script>

<span class="ml-auto flex min-w-0 items-center gap-2">
	{#if failure}
		<span class="min-w-0 truncate text-[11.5px] text-del" title={failure}>{failure}</span>
	{/if}
	{#if busy}
		<span class="text-[11.5px] text-faint">{busy}</span>
	{:else}
		{#if open && pr.isDraft && pr.canEdit}
			<Button variant="solid" size="sm" onclick={() => change('Marking ready…', 'ready')}
				>Ready for review</Button
			>
		{:else if open && pr.canMerge && pr.mergeMethods.length}
			<Button
				variant={merging ? 'outline' : 'solid'}
				size="sm"
				pressed={merging}
				aria-expanded={merging}
				onclick={() => (merging = !merging)}>Merge</Button
			>
		{/if}

		{#if (pr.canEdit && pr.state !== 'MERGED') || updatable}
			<Popover
				bind:open={menu}
				align="end"
				offset={6}
				class="w-44 rounded-2xl border border-line bg-surface p-1 shadow-float"
			>
				{#snippet trigger(props)}
					<button
						{...props}
						class="grid size-5 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg"
						aria-label="More"
					>
						<svg viewBox="0 0 16 16" class="size-3" fill="currentColor"
							><circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle
								cx="13"
								cy="8"
								r="1.4"
							/></svg
						>
					</button>
				{/snippet}
				{#if updatable}
					<button type="button" class={[item, 'hover:text-fg']} onclick={update}
						>Update branch</button
					>
				{/if}
				{#if open && !pr.isDraft && pr.canEdit}
					<button
						type="button"
						class={[item, 'hover:text-fg']}
						onclick={() => change('Converting…', 'draft')}>Convert to draft</button
					>
				{/if}
				{#if open && pr.canEdit}
					<button
						type="button"
						class={[item, 'hover:text-del']}
						onclick={() => change('Closing…', 'close')}>Close pull request</button
					>
				{:else if pr.state === 'CLOSED' && pr.canEdit}
					<button
						type="button"
						class={[item, 'hover:text-fg']}
						onclick={() => change('Reopening…', 'reopen')}>Reopen pull request</button
					>
				{/if}
			</Popover>
		{/if}
	{/if}
</span>
