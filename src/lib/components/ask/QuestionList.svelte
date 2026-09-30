<script lang="ts">
	import type { Group } from '$lib/ask/groups';
	import { shortLines } from '$lib/ask/groups';
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { Thread } from '$lib/ask/types';

	interface Props {
		threads: Threads;
		/** the questions in reading order, see groupThreads */
		grouped: Group[];
	}

	let { threads, grouped }: Props = $props();

	const firstLine = (t: Thread) =>
		t.messages.find((m) => m.role === 'user')?.text.split('\n')[0] ?? '';
</script>

<section class="flex min-h-0 min-w-0 flex-col bg-canvas">
	<header
		class="flex h-11 shrink-0 items-center justify-between gap-2.5 border-b border-line px-3 text-[12px] font-medium"
	>
		<span
			>Questions <span class="font-normal text-faint tabular-nums">{threads.list.length}</span
			></span
		>
		<span class="flex items-center gap-1 font-normal text-faint">
			<kbd class="font-mono text-[10.5px]">j</kbd><kbd class="font-mono text-[10.5px]">k</kbd>
		</span>
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
							>{thread.anchor.path
								? `${shortLines(thread.anchor.label)} · ${thread.anchor.path.split('/').pop()}`
								: 'whole change'}</span
						>
					</span>
				</button>
			{/each}
		{:else}
			<p class="px-2 py-6 text-center text-[12px] text-faint">
				Drag over line numbers, or select code, then press <kbd class="font-mono">a</kbd>.
			</p>
		{/each}
	</div>
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
