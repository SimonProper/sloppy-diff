<script lang="ts">
	import type { Layout } from '$lib/diff/split';
	import SidebarLayout from './SidebarLayout.svelte';

	let { layout }: { layout: Layout } = $props();

	// fixed shapes, so it reads as code and doesn't jump between renders. A line is its
	// width in percent, marked as added or removed by its sign
	const FILES = [
		{ path: 'w-48', lines: [62, 48, -75, -30, 54, 68, 40, 22, 58] },
		{ path: 'w-64', lines: [45, 70, 36, -60, 28, 52] },
		{ path: 'w-40', lines: [55, 34, 66, 47, -72, 25, 50, 38] }
	];
	const LIST = ['w-32', 'w-40', 'w-28', 'w-36', 'w-44', 'w-24'];
</script>

<div role="status" aria-label="Loading the diff" aria-busy="true">
	<SidebarLayout {layout}>
		{#snippet aside()}
			<div class="flex flex-col gap-2.5 px-4 pt-4">
				<div class="bone h-2.5 w-12 rounded-full"></div>
				{#each LIST as width, i (i)}
					<div class="flex h-5 items-center gap-2">
						<div class="bone size-3.5 rounded-[4px]"></div>
						<div class="bone h-2.5 rounded-full {width}"></div>
					</div>
				{/each}
			</div>
		{/snippet}
		{#snippet rail()}
			{#each LIST as _, i (i)}
				<div class="bone size-4 shrink-0 rounded-[4px]"></div>
			{/each}
		{/snippet}
		<main class="flex min-w-0 flex-col gap-4 p-4 pb-24">
			<!-- where the changes bar sits -->
			<div class="-mx-4 -mt-4 flex h-11 items-center gap-2 border-b border-line px-4">
				<div class="bone h-6 w-40 rounded-lg"></div>
				<div class="bone ml-auto h-6 w-24 rounded-lg"></div>
			</div>
			{#each FILES as file, i (i)}
				<section class="overflow-clip rounded-xl border border-line bg-surface">
					<header class="flex h-10 items-center gap-2.5 border-b border-line px-3">
						<div class="bone size-3.5 rounded-[4px]"></div>
						<div class="bone h-3 rounded-full {file.path}"></div>
					</header>
					<div class="py-1">
						{#each file.lines as width, j (j)}
							<div
								class={[
									'flex h-5 items-center',
									width < 0 ? 'bg-del/6' : j % 4 === 1 && 'bg-add/6'
								]}
							>
								<div class="flex w-24 shrink-0 justify-end gap-3 pr-4">
									<div class="bone h-2 w-4 rounded-full"></div>
									<div class="bone h-2 w-4 rounded-full"></div>
								</div>
								<div class="bone h-2.5 rounded-full" style:width="{Math.abs(width) * 0.8}%"></div>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</main>
	</SidebarLayout>
</div>

<style>
	/* one sheen sweeping the whole screen: the gradient is pinned to the viewport,
	   so every bone it passes lights up in step */
	.bone {
		background:
			linear-gradient(100deg, transparent 40%, var(--subtle) 50%, transparent 60%) fixed 0 0 / 200vw
				100% no-repeat,
			var(--line);
		animation: sheen 1.6s ease-in-out infinite;
	}
	@keyframes sheen {
		from {
			background-position-x: 100vw, 0;
		}
		to {
			background-position-x: -100vw, 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bone {
			animation: none;
		}
	}
</style>
