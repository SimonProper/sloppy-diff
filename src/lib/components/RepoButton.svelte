<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { goto } from '$app/navigation';
	import { repoName } from '$lib/repos';
	import Popover from './Popover.svelte';
	import RepoList from './RepoList.svelte';

	let { repo }: { repo: string } = $props();

	let open = $state(false);

	const name = $derived(repoName(repo));

	function pick(path: string) {
		open = false;
		// a new repo starts from a clean comparison
		if (path !== repo) goto(`?${new URLSearchParams({ repo: path })}`);
	}
</script>

<Popover
	bind:open
	class="w-[32rem] overflow-hidden rounded-2xl border border-line bg-surface shadow-float"
>
	{#snippet trigger(props)}
		<Button {...props} size="lg" class="max-w-44" pressed={open} title={repo}>
			<svg
				viewBox="0 0 16 16"
				class="size-3.5 shrink-0 text-faint"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linejoin="round"
				><path
					d="M2 4.5c0-.6.4-1 1-1h3.3l1.4 1.5H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z"
				/></svg
			>
			<span class="truncate text-[12.5px] font-medium text-fg">{name}</span>
		</Button>
	{/snippet}

	<RepoList current={repo} onpick={pick} />
</Popover>
