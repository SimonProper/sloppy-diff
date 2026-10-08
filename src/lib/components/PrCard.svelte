<script lang="ts">
	import type { PullRequest } from '$lib/pr/types';

	let { pr }: { pr: PullRequest } = $props();

	const status = $derived(pr.isDraft && pr.state === 'OPEN' ? 'Draft' : pr.state.toLowerCase());
</script>

<div class="rounded-xl border border-line bg-surface px-4 py-3.5">
	<h2 class="text-[14.5px] leading-snug font-semibold tracking-tight">
		{pr.title} <span class="font-normal text-faint">#{pr.number}</span>
	</h2>
	<p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
		<span
			class={[
				'rounded-[4px] border px-1 text-[10.5px] font-medium capitalize',
				pr.state === 'OPEN' && !pr.isDraft && 'border-add/40 bg-add/10 text-add',
				pr.state === 'MERGED' && 'border-move/40 bg-move/10 text-move',
				pr.state === 'CLOSED' && 'border-del/40 bg-del/10 text-del',
				pr.isDraft && pr.state === 'OPEN' && 'border-line text-muted'
			]}>{status}</span
		>
		<span class="text-muted">{pr.author}</span>
		<span>·</span>
		<span class="font-mono text-[11px]">
			<span class="text-fg">{pr.baseRefName}</span> ← <span class="text-fg">{pr.headRefName}</span>
		</span>
		<span>·</span>
		<a class="text-accent hover:underline" href={pr.url} target="_blank" rel="noopener noreferrer"
			>Open on GitHub</a
		>
	</p>
	{#if pr.bodyHtml}
		<div class="prose mt-3 max-w-3xl text-[12.5px] leading-relaxed text-muted">
			{@html pr.bodyHtml}
		</div>
	{/if}
</div>
