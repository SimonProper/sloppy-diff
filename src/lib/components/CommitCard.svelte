<script lang="ts">
	import { timeAgo, type CommitInfo } from '$lib/refs';

	let { commit }: { commit: CommitInfo } = $props();
</script>

<div class="rounded-xl border border-line bg-surface px-4 py-3.5">
	<h2 class="text-[14.5px] leading-snug font-semibold tracking-tight">{commit.subject}</h2>
	{#if commit.body}
		<p class="mt-2 max-w-3xl text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted">
			{commit.body}
		</p>
	{/if}
	<p class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
		<span class="text-muted">{commit.author}</span>
		<span>·</span>
		<span title={new Date(commit.date).toLocaleString()}>{timeAgo(commit.date)} ago</span>
		<span>·</span>
		<span class="rounded-[4px] bg-subtle px-1 font-mono text-[11px] text-accent">{commit.sha}</span>
		{#if commit.parents.length > 1}
			<span>·</span>
			<span>merge commit, compared against its first parent</span>
		{:else if commit.parents.length === 0}
			<span>·</span>
			<span>first commit, compared against an empty tree</span>
		{/if}
	</p>
</div>
