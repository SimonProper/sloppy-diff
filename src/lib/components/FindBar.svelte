<script lang="ts">
	import { tick, untrack } from 'svelte';
	import Button from './Button.svelte';
	import { clearCurrent, find, search, show, type Match } from '$lib/find.svelte';

	let input = $state<HTMLInputElement>();
	let matches = $state.raw<Match[]>([]);
	let at = $state(-1);

	// searched again as you type and as the diffs change, from the first match in the
	// files on screen onwards, as the browser's find does
	$effect(() => {
		void find.sources;
		const query = find.open ? find.query : '';
		matches = query ? search(query) : [];
		clearCurrent();
		untrack(() => {
			const first = matches.findIndex((m) => m.source.el.getBoundingClientRect().bottom > 0);
			go(Math.max(0, first));
		});
	});

	function go(index: number) {
		at = matches.length ? index : -1;
		if (matches[at]) show(matches[at]);
	}

	const step = (by: number) => go((at + by + matches.length) % matches.length);

	function close() {
		find.open = false;
		clearCurrent();
	}

	async function onkeydown(event: KeyboardEvent) {
		const mod = (event.metaKey || event.ctrlKey) && !event.altKey;
		const key = event.key.toLowerCase();
		if (mod && key === 'f') {
			// pressed again, it's the browser's own find, for what isn't code
			if (document.activeElement === input) return;
			event.preventDefault();
			find.open = true;
			await tick();
			input?.focus();
			input?.select();
		} else if (mod && key === 'g' && find.open) {
			event.preventDefault();
			step(event.shiftKey ? -1 : 1);
		}
	}

	function onfieldkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			step(event.shiftKey ? -1 : 1);
		} else if (event.key === 'Escape') {
			// nothing else on the page closes for it
			event.stopPropagation();
			close();
		}
	}
</script>

<svelte:window {onkeydown} />

{#if find.open}
	<div
		class="absolute top-full right-0 z-20 mt-2 flex h-9 items-center gap-0.5 rounded-full border border-line bg-surface pr-1 pl-3.5 shadow-float"
	>
		<input
			bind:this={input}
			bind:value={find.query}
			onkeydown={onfieldkeydown}
			placeholder="Find in the diffs"
			aria-label="Find in the diffs"
			spellcheck="false"
			class="w-52 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-faint"
		/>
		<span class="mr-1 min-w-16 text-right text-[11px] text-faint tabular-nums" aria-live="polite">
			{#if find.query}{matches.length ? `${at + 1} of ${matches.length}` : 'No results'}{/if}
		</span>
		<Button
			variant="ghost"
			size="sm"
			icon
			aria-label="Previous match"
			title="Previous match  ⇧↵"
			disabled={!matches.length}
			onclick={() => step(-1)}
		>
			{@render chevron('m4 10 4-4 4 4')}
		</Button>
		<Button
			variant="ghost"
			size="sm"
			icon
			aria-label="Next match"
			title="Next match  ↵"
			disabled={!matches.length}
			onclick={() => step(1)}
		>
			{@render chevron('m4 6 4 4 4-4')}
		</Button>
		<Button variant="ghost" size="sm" icon aria-label="Close" title="Close  esc" onclick={close}>
			{@render chevron('m4.5 4.5 7 7m0-7-7 7')}
		</Button>
	</div>
{/if}

{#snippet chevron(d: string)}
	<svg
		viewBox="0 0 16 16"
		class="size-3.5"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"><path {d} /></svg
	>
{/snippet}

<style>
	/* what's found, the one it's on stronger. Here rather than in layout.css, whose optimizer
	   doesn't know highlights and warns on every build */
	:global(::highlight(find)) {
		background: color-mix(in oklab, var(--mod) 30%, transparent);
	}
	:global(::highlight(find-current)) {
		background: color-mix(in oklab, var(--mod) 70%, transparent);
	}
</style>
