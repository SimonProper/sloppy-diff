<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { DiffFile } from '$lib/diff/types';
	import { displayPath, splitPath } from '$lib/diff/path';
	import { fileTree, type TreeNode } from '$lib/diff/tree';
	import { reveal } from '$lib/scroll-spy.svelte';
	import { readText, writeText } from '$lib/storage';
	import StatusBadge from './StatusBadge.svelte';

	interface Props {
		files: DiffFile[];
		/** the file on screen, marked and kept in view in the list */
		current?: string | null;
	}

	let { files, current = null }: Props = $props();
	let list = $state<HTMLElement>();

	type View = 'list' | 'tree';
	const KEY = 'file-list-view';

	// a per-browser preference, the list when nothing is stored
	let view = $state<View>(readText(KEY) === 'tree' ? 'tree' : 'list');
	const tree = $derived(view === 'tree' ? fileTree(files) : []);
	/** folders folded shut, by path, for this visit */
	const folded = new SvelteSet<string>();

	function choose(next: View) {
		view = next;
		writeText(KEY, next);
	}

	function fold(path: string) {
		if (folded.has(path)) folded.delete(path);
		else folded.add(path);
	}

	// folders stick at the top while their files scroll, nested ones stacked under
	// their parent, the way editors' sticky scroll works. Capped so the stack
	// can't take over the list
	const STICKY_DEPTH = 3;
	/** a folder row's height, h-7, what each level of the stack is offset by */
	const ROW = 28;

	$effect(() => {
		const row = current && list?.querySelector<HTMLElement>(`[data-file="${CSS.escape(current)}"]`);
		// clear of the folder rows stuck above it
		if (row) reveal(row, Math.min(Number(row.dataset.depth), STICKY_DEPTH) * ROW);
	});

	const VIEWS: { view: View; label: string }[] = [
		{ view: 'list', label: 'Flat list' },
		{ view: 'tree', label: 'Folder tree' }
	];
</script>

<div class="flex shrink-0 items-center justify-between px-4 pt-3 pb-1">
	<p class="text-[10.5px] font-medium tracking-wide text-faint uppercase">
		Files · {files.length}
	</p>
	<div class="flex rounded-md border border-line p-px" role="group" aria-label="File list view">
		{#each VIEWS as option (option.view)}
			<button
				type="button"
				class={[
					'grid h-5 w-6 place-items-center rounded-[5px]',
					view === option.view ? 'bg-subtle text-fg' : 'text-faint hover:text-fg'
				]}
				title={option.label}
				aria-label={option.label}
				aria-pressed={view === option.view}
				onclick={() => choose(option.view)}
			>
				<svg
					viewBox="0 0 16 16"
					class="size-3"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				>
					{#if option.view === 'list'}
						<path d="M3 4h10M3 8h10M3 12h10" />
					{:else}
						<path d="M3 3.5h5M6 8h7M6 12.5h7M4.5 3.5v9H6M4.5 8H6" />
					{/if}
				</svg>
			</button>
		{/each}
	</div>
</div>

<nav bind:this={list} class="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2">
	{#if view === 'list'}
		{#each files as file (file.id)}
			{@const path = splitPath(displayPath(file))}
			{@render row(file, 0, path.name, path.dir.replace(/\/$/, ''))}
		{/each}
	{:else}
		{@render nodes(tree, 0)}
	{/if}
</nav>

{#snippet nodes(list: TreeNode[], depth: number)}
	{#each list as node (node.kind === 'dir' ? `d:${node.path}` : `f:${node.file.id}`)}
		{#if node.kind === 'dir'}
			{@const open = !folded.has(node.path)}
			{@const sticky = depth < STICKY_DEPTH}
			<!-- the folder wraps its contents, so its sticky row lets go when they end -->
			<div class="flex flex-col gap-px">
				<div
					class={['folder', sticky && 'sticky']}
					style:top={sticky ? `${depth * ROW}px` : null}
					style:z-index={sticky ? STICKY_DEPTH - depth : null}
				>
					<button
						type="button"
						class="flex h-7 w-full items-center gap-1.5 rounded-lg bg-canvas pr-2 text-left text-[12.5px] text-muted hover:bg-subtle hover:text-fg"
						style:padding-left="{8 + depth * 12}px"
						title={node.path}
						aria-expanded={open}
						onclick={() => fold(node.path)}
					>
						<svg
							viewBox="0 0 16 16"
							class={['size-3 shrink-0 text-faint transition-transform', !open && '-rotate-90']}
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="m4 6 4 4 4-4" /></svg
						>
						<span class="min-w-0 flex-1 truncate">{node.name}</span>
						<span class="shrink-0 font-mono text-[10.5px] tabular-nums opacity-70">
							<span class="text-add">+{node.additions}</span>
							<span class="text-del">−{node.deletions}</span>
						</span>
					</button>
				</div>
				{#if open}
					{@render nodes(node.children, depth + 1)}
				{/if}
			</div>
		{:else}
			{@render row(node.file, depth, node.name, '')}
		{/if}
	{/each}
{/snippet}

{#snippet row(file: DiffFile, depth: number, name: string, dir: string)}
	{@const here = file.id === current}
	<a
		href="#{file.id}"
		class={[
			'group relative flex items-center gap-2 rounded-lg py-1.5 pr-2 text-[12.5px] hover:bg-subtle',
			here && 'current bg-subtle'
		]}
		style:padding-left="{8 + depth * 12}px"
		title={displayPath(file)}
		aria-current={here ? 'location' : undefined}
		data-file={file.id}
		data-depth={depth}
	>
		<StatusBadge status={file.status} />
		<span class="min-w-0 flex-1 truncate">
			<span class="font-medium">{name}</span>
			{#if dir}<span class="text-[11px] text-faint">{dir}</span>{/if}
		</span>
		<span class="shrink-0 font-mono text-[10.5px] tabular-nums">
			<span class="text-add">+{file.additions}</span>
			<span class="text-del">−{file.deletions}</span>
		</span>
	</a>
{/snippet}

<style>
	/* the file on screen, a bar at the row's edge */
	.current::before {
		content: '';
		position: absolute;
		inset-block: 6px;
		left: 0;
		width: 2px;
		border-radius: 1px;
		background: var(--accent);
	}
	/* a line under a folder row only while it's stuck, where scroll-state queries exist */
	.folder {
		container-type: scroll-state;
	}
	@container scroll-state(stuck: top) {
		.folder > button {
			border-radius: 0;
			box-shadow: 0 1px 0 var(--line);
		}
	}
</style>
