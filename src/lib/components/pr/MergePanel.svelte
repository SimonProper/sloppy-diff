<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { errorText } from '$lib/errors';
	import { mergePr, updatePrBranch } from '$lib/pr/pr.remote';
	import { refresh } from '$lib/pr/refresh';
	import type { MergeMethod, MergeState, PullRequest } from '$lib/pr/types';
	import SegmentedControl from '../SegmentedControl.svelte';

	let { pr, onclose }: { pr: PullRequest; onclose: () => void } = $props();

	const METHODS: Record<MergeMethod, [string, string]> = {
		SQUASH: ['Squash', 'Squash and merge'],
		MERGE: ['Merge commit', 'Create merge commit'],
		REBASE: ['Rebase', 'Rebase and merge']
	};

	/** what keeps it from merging, null when nothing does */
	const BLOCKED: Partial<Record<MergeState, string>> = {
		BEHIND: 'The base has moved on, update the branch first',
		BLOCKED: 'Required reviews or checks aren’t met yet',
		DIRTY: 'It conflicts with the base, resolve that first',
		DRAFT: 'It’s a draft',
		UNKNOWN: 'GitHub is still working out whether it merges'
	};

	let method = $derived<MergeMethod>(pr.mergeMethods[0] ?? 'MERGE');
	// GitHub's own, from the pull request: its title and description squashed, the usual
	// merge commit otherwise. Picking another method starts over from its own, a reload
	// of the page doesn't
	const message = (m: MergeMethod) =>
		untrack(() =>
			m === 'SQUASH'
				? { headline: `${pr.title} (#${pr.number})`, body: pr.body }
				: {
						headline: `Merge pull request #${pr.number} from ${pr.headOwner ? `${pr.headOwner}:` : ''}${pr.headRefName}`,
						body: pr.title
					}
		);
	let headline = $derived(message(method).headline);
	let body = $derived(message(method).body);
	let deleteBranch = $state(true);

	let busy = $state<string | null>(null);
	let failure = $state('');

	const blocked = $derived(BLOCKED[pr.mergeState] ?? null);
	const updatable = $derived(pr.canUpdateBranch || pr.canMerge);

	async function run(doing: string, task: () => Promise<unknown>, done = false) {
		busy = doing;
		failure = '';
		try {
			await task();
			if (done) onclose();
			await refresh();
		} catch (e) {
			failure = errorText(e);
		} finally {
			busy = null;
		}
	}

	const repo = () => page.data.repo as string;
	const update = () =>
		run('Updating…', () =>
			updatePrBranch({ repo: repo(), number: pr.number, pr: pr.id, head: pr.headRefOid })
		);
	const merge = () =>
		run(
			'Merging…',
			() =>
				mergePr({
					repo: repo(),
					number: pr.number,
					pr: pr.id,
					options: {
						method,
						head: pr.headRefOid,
						...(method !== 'REBASE' && { headline, body }),
						...(deleteBranch && pr.branchToDelete && { deleteBranch: pr.branchToDelete })
					}
				}),
			true
		);

	// no boxes, the text sits in the card like the description does; the placeholders say what's what
	const field = 'block w-full bg-transparent p-0 text-fg outline-none placeholder:text-faint';

	// as tall as the text, the card grows with it. Runs again as it's typed
	function grow(textarea: HTMLTextAreaElement) {
		void body;
		void headline;
		textarea.style.height = '';
		textarea.style.height = `${textarea.scrollHeight}px`;
	}
</script>

<!-- under the card it opened from, the commit as GitHub would write it, there to change -->
<section class="rounded-xl border border-line bg-surface p-5">
	<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
		<!-- on one baseline, the mono name is smaller than the label -->
		<span class="flex min-w-0 items-baseline gap-2">
			<span class="font-medium text-fg">Merge</span>
			<span class="min-w-0 truncate font-mono text-[11px] text-faint">
				{pr.baseRefName} ← {pr.headRefName}
			</span>
		</span>
		{#if pr.mergeMethods.length > 1}
			<span class="ml-auto">
				<SegmentedControl
					options={pr.mergeMethods.map((m) => ({ value: m, label: METHODS[m][0] }))}
					value={method}
					onchange={(m) => (method = m)}
					size="sm"
					text="sm"
					label="Merge method"
				/>
			</span>
		{/if}
	</div>

	{#if method === 'REBASE'}
		<p class="mt-4 text-[13px] text-muted">
			Each commit goes onto {pr.baseRefName} as it is, without a merge commit.
		</p>
	{:else}
		<!-- a line that wraps rather than scrolling out of sight, Enter doesn't break it -->
		<textarea
			bind:value={headline}
			rows="1"
			class={[field, 'mt-4 resize-none text-[15px] leading-snug font-semibold tracking-tight']}
			placeholder="Commit title"
			aria-label="Commit title"
			onkeydown={(e) => e.key === 'Enter' && e.preventDefault()}
			{@attach grow}></textarea>
		<textarea
			bind:value={body}
			rows="1"
			class={[field, 'mt-2 resize-none text-[13px] leading-relaxed']}
			placeholder="Add a description…"
			aria-label="Commit description"
			{@attach grow}></textarea>
	{/if}

	<div class="mt-4 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
		{#if pr.branchToDelete}
			<label class="flex cursor-pointer items-center gap-1.5 text-muted">
				<input type="checkbox" class="size-3.5 accent-ink" bind:checked={deleteBranch} />
				Delete <span class="font-mono text-[11px] text-fg">{pr.headRefName}</span>
			</label>
		{/if}
		{#if failure}
			<span class="min-w-0 text-[11.5px] text-del">{failure}</span>
		{:else if blocked}
			<span class="min-w-0 text-[11.5px] text-mod">{blocked}</span>
		{:else if pr.mergeState === 'UNSTABLE'}
			<span class="min-w-0 text-[11.5px] text-mod"
				>Some checks are failing, none of them required</span
			>
		{/if}
		<span class="ml-auto flex items-center gap-2">
			{#if busy}
				<span class="text-[11.5px] text-faint">{busy}</span>
			{:else}
				<button type="button" class="px-1 text-muted hover:text-fg" onclick={onclose}>Cancel</button
				>
				{#if pr.mergeState === 'BEHIND' && updatable}
					<button
						type="button"
						class="h-6 rounded-md border border-line px-2.5 text-[12px] text-muted shadow-raised hover:border-muted hover:text-fg active:shadow-pressed"
						onclick={update}>Update branch</button
					>
				{/if}
				<button
					type="button"
					class="h-6 rounded-md bg-ink px-2.5 text-[12px] font-medium text-surface shadow-raised active:shadow-pressed enabled:hover:opacity-80 disabled:opacity-50"
					disabled={!!blocked}
					onclick={merge}>{METHODS[method][1]}</button
				>
			{/if}
		</span>
	</div>
</section>
