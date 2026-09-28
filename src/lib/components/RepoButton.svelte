<script lang="ts">
	import { goto } from '$app/navigation';
	import { Popover, PopoverContent, PopoverTrigger } from './popover';
	import RepoList from './RepoList.svelte';

	let { repo }: { repo: string } = $props();

	let open = $state(false);

	const name = $derived(repo.split('/').filter(Boolean).pop() ?? repo);

	function pick(path: string) {
		open = false;
		// a new repo starts from a clean comparison
		if (path !== repo) goto(`?${new URLSearchParams({ repo: path })}`);
	}
</script>

<Popover bind:open>
	<PopoverTrigger
		class={[
			'flex h-8 max-w-44 items-center gap-2 rounded-lg border bg-surface px-2.5 hover:border-muted',
			open ? 'border-muted' : 'border-line'
		]}
		title={repo}
	>
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
		<span class="truncate text-[12.5px] font-medium">{name}</span>
	</PopoverTrigger>

	<PopoverContent
		class="w-[32rem] overflow-hidden rounded-xl border border-line bg-surface shadow-[0_8px_30px_-12px_rgb(0_0_0/0.25)]"
	>
		<RepoList current={repo} onpick={pick} />
	</PopoverContent>
</Popover>
