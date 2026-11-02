<script lang="ts">
	import type { PrSummary } from '$lib/pr/types';

	/** what the list knew of it, shown while the rest loads */
	let { summary }: { summary?: PrSummary } = $props();
</script>

<!-- the next pull request's overview loading, shaped like its header card -->
<div
	class="mx-auto flex w-full max-w-4xl flex-col gap-6"
	role="status"
	aria-label="Loading the pull request"
	aria-busy="true"
>
	<section class="overflow-hidden rounded-2xl border border-line bg-surface">
		<div class="p-5">
			{#if summary}
				<h1 class="text-[17px] leading-snug font-semibold tracking-tight">
					{summary.title} <span class="font-normal text-faint">#{summary.number}</span>
				</h1>
				<p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
					{#if summary.isDraft}
						<span class="rounded-sm border border-line px-1 text-[10.5px] font-medium text-muted"
							>Draft</span
						>
					{/if}
					<span class="text-muted">{summary.author}</span>
					<span>·</span>
					<span class="font-mono text-[11px]">
						<span class="text-fg">{summary.baseRefName}</span> ←
						<span class="text-fg">{summary.headRefName}</span>
					</span>
				</p>
			{:else}
				<div class="bone h-4 w-2/3 rounded-full"></div>
				<div class="bone mt-3 h-2.5 w-64 rounded-full"></div>
			{/if}
			<div class="mt-6 flex max-w-3xl flex-col gap-2.5">
				{#each [92, 85, 70, 88, 40] as width, i (i)}
					<div class="bone h-2.5 rounded-full" style:width="{width}%"></div>
				{/each}
			</div>
		</div>
		<div class="flex h-10 items-center gap-5 border-t border-line bg-subtle px-5">
			<div class="bone h-2.5 w-24 rounded-full"></div>
			<div class="bone h-2.5 w-20 rounded-full"></div>
		</div>
	</section>
</div>
