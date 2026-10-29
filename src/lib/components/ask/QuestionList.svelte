<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { otherThreads } from '$lib/ask/ask.remote';
	import type { Group } from '$lib/ask/groups';
	import { shortLines } from '$lib/ask/groups';
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { Anchor, Elsewhere, Thread } from '$lib/ask/types';
	import { timeAgo } from '$lib/refs';

	interface Props {
		threads: Threads;
		/** the questions in reading order, see groupThreads */
		grouped: Group[];
		/** buttons at the end of the header, in place of the j k hint */
		actions?: Snippet;
		/** under the list, the docked panel's new chat */
		children?: Snippet;
	}

	let { threads, grouped, actions, children }: Props = $props();

	const firstLine = (t: Thread) =>
		t.messages.find((m) => m.role === 'user')?.text.split('\n')[0] ?? '';

	/** "L12–15 · cart.ts", what a chat is about at a glance */
	const place = (anchor: Pick<Anchor, 'path' | 'label'>) =>
		anchor.path ? `${shortLines(anchor.label)} · ${anchor.path.split('/').pop()}` : 'whole change';

	// chats about the repo's other diffs, so a renamed branch or a rebase never loses one
	const elsewhere = $derived(otherThreads(threads.where));
	const KIND = { pr: 'PR', branch: 'Branch', commit: 'Commit', range: 'Range', worktree: 'Local' };
	/** a diff's chats past the first few, shown */
	let more = $state<Record<string, boolean>>({});

	/** The page on another diff, the rest of the url as it is. */
	function hrefOf(e: Elsewhere) {
		const params = new URLSearchParams(page.url.searchParams);
		for (const key of ['from', 'to', 'branch', 'commits', 'commit', 'on', 'pr', 'view']) {
			params.delete(key);
		}
		for (const [key, value] of Object.entries(e.params)) params.set(key, value);
		return `?${params}`;
	}
</script>

<section class="flex min-h-0 min-w-0 flex-col bg-canvas">
	<header
		class="flex h-11 shrink-0 items-center justify-between gap-2.5 border-b border-line px-3 text-[12px] font-medium shadow-strip"
	>
		<span>Chats <span class="font-normal text-faint tabular-nums">{threads.list.length}</span></span
		>
		{#if actions}
			<span class="flex items-center gap-1">{@render actions()}</span>
		{:else}
			<span class="flex items-center gap-1 font-normal text-faint">
				<kbd class="font-mono text-[10.5px]">j</kbd><kbd class="font-mono text-[10.5px]">k</kbd>
			</span>
		{/if}
	</header>
	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		{#each grouped as group (group.key)}
			<p
				class="truncate px-2 pt-2 pb-1 text-[10.5px] font-medium tracking-wide text-faint uppercase first:pt-1"
				title={group.label}
			>
				{group.label}
			</p>
			{#each group.threads as thread (thread.id)}
				{@const status = threads.status(thread)}
				<button
					type="button"
					class={[
						'flex w-full items-start gap-[9px] rounded-lg px-2 py-[7px] text-left hover:bg-subtle',
						threads.open === thread.id && 'bg-subtle'
					]}
					onclick={() => threads.openLens(thread.id)}
				>
					<span
						class={[
							'dot mt-[5px] size-[7px] shrink-0 rounded-full',
							thread.outdated ? 'outdated' : status
						]}
					></span>
					<span class="min-w-0">
						<span
							class={[
								'line-clamp-2 text-[12.5px] leading-[1.35]',
								threads.open === thread.id && 'font-medium',
								thread.outdated && 'text-muted'
							]}>{firstLine(thread)}</span
						>
						<span class="mt-0.5 block truncate font-mono text-[10.5px] text-faint"
							>{place(thread.anchor)}</span
						>
					</span>
				</button>
			{/each}
		{:else}
			<p class="px-2 py-6 text-center text-[12px] text-faint">
				Ask about the whole change below, or drag over line numbers or select code, then press
				<kbd class="font-mono">a</kbd>.
			</p>
		{/each}
		{#if elsewhere.current?.length}
			<details class="group mt-3 border-t border-line pt-1">
				<!-- a peer of the Chats header above, not another group label -->
				<summary
					class="flex cursor-pointer list-none items-center gap-1.5 px-2 py-2 text-[12px] font-medium [&::-webkit-details-marker]:hidden"
				>
					<span class="text-faint transition-transform duration-150 ease-out group-open:rotate-90"
						>›</span
					>
					Other diffs
					<span class="font-normal text-faint tabular-nums"
						>{elsewhere.current.reduce((n, e) => n + e.threads.length, 0)}</span
					>
				</summary>
				{#each elsewhere.current as e (e.scope)}
					<div class="mt-3 first:mt-1">
						<a
							href={hrefOf(e)}
							class="flex items-baseline gap-2 rounded-lg px-2 py-1 hover:bg-subtle focus-visible:bg-subtle"
							title={e.label}
						>
							<span class="min-w-0 flex-1 truncate text-[12.5px] font-medium">{e.label}</span>
							<span class="shrink-0 text-[10.5px] text-faint tabular-nums"
								>{KIND[e.kind]} · {timeAgo(e.threads[0].at)}</span
							>
						</a>
						<!-- indented to where the questions above start, past their dots -->
						{#each more[e.scope] ? e.threads : e.threads.slice(0, 3) as t (t.id)}
							<a
								href={hrefOf(e)}
								class="block rounded-lg py-[5px] pr-2 pl-6 hover:bg-subtle focus-visible:bg-subtle"
								onclick={() => (threads.opening = t.id)}
							>
								<span class="block truncate text-[12.5px] leading-[1.35] text-muted"
									>{t.question}</span
								>
								<span class="mt-0.5 block truncate font-mono text-[10.5px] text-faint"
									>{place(t.anchor)}</span
								>
							</a>
						{/each}
						{#if e.threads.length > 3 && !more[e.scope]}
							<button
								type="button"
								class="rounded-lg py-1 pr-2 pl-6 text-[11px] text-faint hover:text-muted focus-visible:text-muted"
								onclick={() => (more[e.scope] = true)}>{e.threads.length - 3} more</button
							>
						{/if}
					</div>
				{/each}
			</details>
		{/if}
	</div>
	{@render children?.()}
</section>

<style>
	.dot {
		background: var(--ink);
	}
	.dot.seen,
	.dot.outdated {
		background: none;
		border: 1.5px solid var(--ink-soft);
	}
	.dot.outdated {
		border-color: var(--faint);
	}
	.dot.live {
		animation: pulse 1.2s ease-in-out infinite;
	}
	.dot.error {
		background: var(--del);
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}
</style>
