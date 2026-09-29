<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { slowNavigation } from '$lib/slow.svelte';
	import FileDiff from '$lib/components/FileDiff.svelte';
	import LayoutToggle from '$lib/components/LayoutToggle.svelte';

	let { data } = $props();

	const LABELS = { lines: 'Lines', tokens: 'Tokens' } as const;

	const passed = $derived(data.checks.filter((c) => c.status === 'pass').length);
	const failed = $derived(data.checks.filter((c) => c.status === 'fail').length);

	// svelte-ignore state_referenced_locally
	let layout = $state(data.layout);

	const loading = slowNavigation();
	let rerunning = $state(false);
	async function rerun() {
		rerunning = true;
		await invalidateAll();
		rerunning = false;
	}
</script>

<svelte:head>
	<title>Change modes · smoke test</title>
</svelte:head>

<div class="min-h-screen font-sans">
	<header
		class="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-canvas px-4"
	>
		<a
			href="/"
			class="grid size-6 shrink-0 place-items-center rounded-md border border-fg font-mono text-[12px]"
			title="Back to the diff">±</a
		>
		<h1 class="text-[13px] font-medium">Change modes smoke test</h1>

		<span
			class={[
				'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-medium',
				failed ? 'bg-del/10 text-del' : 'bg-add/10 text-add'
			]}
		>
			<span class={['size-1.5 rounded-full', failed ? 'bg-del' : 'bg-add']}></span>
			{failed ? `${failed} failing` : 'All passing'}
		</span>
		<span class="text-[12px] text-muted tabular-nums">
			{passed} of {data.checks.length} checks pass
		</span>

		<div class="ml-auto flex items-center gap-3">
			<LayoutToggle bind:layout />
			<button
				type="button"
				class="h-8 rounded-lg bg-accent px-3 text-[12px] font-medium text-surface hover:opacity-90 disabled:opacity-50"
				disabled={rerunning}
				onclick={rerun}>{rerunning ? 'Running…' : 'Rerun'}</button
			>
			<a
				href="/"
				class="flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[12px] hover:border-muted"
				>Back to diff</a
			>
		</div>

		{#if loading.current || rerunning}
			<div class="absolute inset-x-0 -bottom-px h-px overflow-hidden">
				<div class="loading h-full w-1/3 bg-accent"></div>
			</div>
		{/if}
	</header>

	<main class="flex flex-col gap-10 p-4 pb-24">
		<div class="rounded-xl border border-line bg-surface p-4 text-[12.5px] leading-relaxed">
			<p class="text-muted">
				Every run builds a throwaway git repo with one change per file below, diffs it in both modes
				and runs the same checks as <code class="font-mono text-fg">pnpm test</code>. What to look
				for:
			</p>
			<ul class="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-[12px]">
				<li class="flex items-center gap-2.5">
					<span class="rounded-[3px] bg-(--add-novel) px-1 font-mono text-[11.5px]">quantity</span>
					<span class="text-muted">the pieces of a changed line that are actually new</span>
				</li>
				<li class="flex items-center gap-2.5">
					<span
						class="rounded-[3px] bg-surface px-1 font-mono text-[11.5px] opacity-50 ring-1 ring-line"
						>reformatted line</span
					>
					<span class="text-muted"
						>changed for git, but only re-indented or re-wrapped: nothing new</span
					>
				</li>
				<li class="flex items-center gap-2.5">
					<span class="rounded-md bg-mod/10 px-1.5 py-0.5 text-[10.5px] font-medium text-mod"
						>formatting only</span
					>
					<span class="text-muted">every changed line in the file is reformatted</span>
				</li>
			</ul>
		</div>

		{#each data.files as fixture (fixture.path)}
			<section class="flex flex-col gap-3">
				<div class="px-1">
					<h2 class="font-mono text-[13px] font-medium">{fixture.path}</h2>
					<p class="mt-0.5 text-[12px] text-muted">{fixture.about}</p>
				</div>

				<!-- split panels need the width, so the modes stack instead of sitting side by side -->
				<div class={['grid gap-3', layout === 'split' ? 'grid-cols-1' : 'grid-cols-2']}>
					{#each fixture.modes as { mode, file } (mode)}
						{@const checks = data.checks.filter((c) => c.file === fixture.path && c.mode === mode)}
						{@const failing = checks.some((c) => c.status === 'fail')}
						<div class="flex min-w-0 flex-col gap-2">
							<p class="flex items-center gap-2 px-1 text-[12px] font-medium">
								<span class={['size-1.5 rounded-full', failing ? 'bg-del' : 'bg-add']}></span>
								{LABELS[mode]}
							</p>

							<FileDiff {file} anchor="{mode}-{file.id}" sticky={false} expanded {layout} />

							<ul class="flex flex-col gap-1 px-1">
								{#each checks as check (check.label)}
									<li class="flex items-start gap-2 text-[11.5px] leading-snug">
										{#if check.status === 'pass'}
											<svg
												viewBox="0 0 16 16"
												class="mt-px size-3.5 shrink-0 text-add"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg
											>
										{:else if check.status === 'fail'}
											<svg
												viewBox="0 0 16 16"
												class="mt-px size-3.5 shrink-0 text-del"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg
											>
										{/if}
										<span class="min-w-0">
											<span class="text-muted">{check.label}</span>
											{#if check.status === 'fail'}
												<span class="block font-mono text-[11px] break-words text-del"
													>{check.detail}</span
												>
											{/if}
										</span>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</main>
</div>

<style>
	.loading {
		animation: slide 1s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}
</style>
