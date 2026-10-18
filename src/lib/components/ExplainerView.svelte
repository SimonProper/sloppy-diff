<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { errorText } from '$lib/errors';
	import { explainerDocument } from '$lib/explainer/document';
	import {
		cancelExplainer,
		followExplainer,
		generateExplainer,
		getExplainer
	} from '$lib/explainer/explainers.remote';
	import type { ExplainerProgress, VisualExplainer } from '$lib/explainer/types';
	import ToolText from './ToolText.svelte';

	interface Props {
		repo: string;
		start: string;
		stop: string;
		pr?: number;
		toolbar?: Snippet;
		hasChanges?: boolean;
	}

	let { repo, start, stop, pr, toolbar, hasChanges = true }: Props = $props();
	type Range = { repo: string; start: string; stop: string };
	let range = $state<Range | null>(null);
	let explainer = $state<VisualExplainer | null>(null);
	let progress = $state<ExplainerProgress | null>(null);
	let loading = $state(true);
	let generating = $state(false);
	let starting = $state(false);
	let cancelling = $state(false);
	let failure = $state('');
	let focus = $state('');
	let closed = false;
	let operation = 0;

	const tools = $derived(progress?.tools.slice(-5) ?? []);
	const preview = $derived(explainer ? explainerDocument(explainer.html) : '');
	const canGenerate = $derived(hasChanges && !loading && !generating && !!range);
	const focusId = $props.id();

	function current(serial: number) {
		return !closed && serial === operation;
	}

	async function readLatest(target: Range) {
		const query = getExplainer(target);
		// This tab may have been closed while a job finished. Refresh the remote cache
		// before reading it so reopening always sees the saved result and current job.
		await query.refresh();
		return await query;
	}

	async function load() {
		if (generating) return;
		const serial = ++operation;
		loading = true;
		failure = '';
		try {
			const next = await readLatest({ repo, start, stop });
			if (!current(serial)) return;
			range = { repo: next.repo, start: next.start, stop: next.stop };
			explainer = next.explainer;
			loading = false;
			if (next.running) {
				generating = true;
				await follow(range, serial);
			}
		} catch (e) {
			if (current(serial)) failure = errorText(e);
		} finally {
			if (current(serial)) loading = false;
		}
	}

	onMount(() => {
		void load();
		return () => {
			closed = true;
			operation += 1;
		};
	});

	async function follow(target: Range, serial: number) {
		let terminal = false;
		try {
			const follow = crypto.randomUUID();
			for await (const next of followExplainer({ ...target, follow })) {
				if (!current(serial)) break;
				progress = next;
				if (next.error) {
					terminal = true;
					failure = next.error;
					break;
				}
				if (next.done) {
					terminal = true;
					const saved = await readLatest({ ...target, ...next.done });
					if (!current(serial)) return;
					if (saved.explainer) explainer = saved.explainer;
					else failure = 'The explainer finished, but could not be loaded. Please try again.';
					break;
				}
			}
			if (current(serial) && !terminal) {
				failure = 'The progress connection ended. Try again to reconnect to this generation.';
			}
		} catch (e) {
			if (current(serial)) failure = errorText(e);
		} finally {
			if (current(serial)) {
				generating = false;
				cancelling = false;
			}
		}
	}

	async function generate() {
		if (!canGenerate) return;
		// Lock before the command resolves, including rapid repeated clicks.
		generating = true;
		starting = true;
		failure = '';
		progress = null;
		const serial = ++operation;
		try {
			const resolved = await generateExplainer({
				repo,
				start,
				stop,
				pr,
				focus: focus.trim() || undefined
			});
			if (!current(serial)) return;
			range = resolved;
			starting = false;
			await follow(resolved, serial);
		} catch (e) {
			if (current(serial)) failure = errorText(e);
		} finally {
			if (current(serial)) {
				generating = false;
				starting = false;
			}
		}
	}

	async function cancel() {
		if (!range || !generating || starting || cancelling) return;
		const serial = operation;
		cancelling = true;
		try {
			await cancelExplainer(range);
		} catch (e) {
			if (current(serial)) {
				failure = `Could not cancel: ${errorText(e)}`;
				cancelling = false;
			}
		}
	}

	function download() {
		if (!explainer) return;
		const blob = new Blob([explainerDocument(explainer.html)], { type: 'text/html;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		const name = explainer.title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
		link.href = url;
		link.download = `${name.slice(0, 80) || 'visual-explainer'}.html`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<main class="min-w-0 p-4 pb-12">
	{@render toolbar?.()}

	{#if loading}
		<div class="flex items-center justify-center gap-2 py-24 text-[12px] text-muted" role="status">
			<span
				class="size-3.5 animate-spin rounded-full border-2 border-line border-t-accent motion-reduce:animate-none"
			></span>
			Loading visual explainer…
		</div>
	{:else}
		<section
			class={[
				'mt-4 overflow-hidden rounded-xl border border-line bg-surface',
				!explainer && 'mx-auto max-w-2xl'
			]}
			aria-label="Visual explainer"
		>
			{#if explainer}
				<header class="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
					<div class="min-w-0 flex-1">
						<p class="mb-1 text-[10.5px] font-medium tracking-wide text-faint uppercase">
							Visual explainer
						</p>
						<h1 class="text-[17px] font-semibold tracking-tight">{explainer.title}</h1>
						{#if explainer.summary}
							<p class="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted">
								{explainer.summary}
							</p>
						{/if}
					</div>
					<div class="flex shrink-0 items-center gap-2">
						<button
							type="button"
							onclick={download}
							class="h-8 rounded-lg border border-line px-3 text-[12px] font-medium text-muted shadow-raised hover:border-muted hover:text-fg active:shadow-pressed"
							>Download HTML</button
						>
						<button
							type="button"
							onclick={generate}
							disabled={!canGenerate}
							class="h-8 rounded-lg border border-line px-3 text-[12px] font-medium shadow-raised hover:border-muted active:shadow-pressed disabled:opacity-40"
							>Regenerate</button
						>
					</div>
				</header>
				<details class="border-t border-line px-5 py-2.5">
					<summary class="w-fit cursor-pointer text-[11.5px] text-muted hover:text-fg"
						>Choose a focus for regeneration</summary
					>
					<div class="max-w-2xl pt-3 pb-1">
						{@render focusField()}
					</div>
				</details>
			{:else}
				<div class="px-6 pt-8 pb-6 sm:px-8">
					<div
						class="mb-5 grid size-12 place-items-center rounded-xl border border-line bg-subtle text-accent"
						aria-hidden="true"
					>
						<svg
							viewBox="0 0 32 32"
							class="size-7"
							fill="none"
							stroke="currentColor"
							stroke-width="1.3"
							stroke-linejoin="round"
							><path d="m16 3 11 6.5v13L16 29 5 22.5v-13L16 3Z" /><path
								d="m5 9.5 11 6.4 11-6.4M16 16v13M16 3v13L5 22.5m11-6.6 11 6.6"
								opacity=".55"
							/><circle cx="16" cy="16" r="3" fill="var(--surface)" /></svg
						>
					</div>
					<h1 class="text-[20px] font-semibold tracking-tight">See the ideas behind the change</h1>
					<p class="mt-2 max-w-lg text-[13px] leading-relaxed text-muted">
						Turn this commit range into an interactive visual explainer. Animated 3D scenes make the
						concepts, relationships, and before-and-after behavior easier to understand.
					</p>
					<p class="mt-3 font-mono text-[11px] text-faint">
						{(range?.start || start).slice(0, 7)}..{(range?.stop || stop).slice(0, 7)}
					</p>
					<div class="mt-6">{@render focusField()}</div>
					{#if !hasChanges}
						<p class="mt-3 text-[12px] text-muted">
							There are no changes in this range. Choose commits with changes to create an
							explainer.
						</p>
					{/if}
					<button
						type="button"
						onclick={generate}
						disabled={!canGenerate}
						class="mt-4 h-9 rounded-lg bg-accent px-4 text-[12px] font-medium text-surface hover:opacity-90 disabled:opacity-40"
						>{generating
							? 'Creating visual explainer…'
							: failure && range
								? 'Try again'
								: 'Generate visual explainer'}</button
					>
					<p class="mt-3 text-[11px] text-faint">
						Your selected agent reads the code and builds a saved explainer for this range.
					</p>
				</div>
			{/if}

			{#if generating}
				<div class="border-t border-line bg-subtle/40 px-5 py-4" role="status" aria-live="polite">
					<div class="flex items-center gap-2.5">
						<span
							class="size-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
						></span>
						<p class="min-w-0 flex-1 text-[12.5px] font-medium">
							{progress?.status || 'Starting the agent…'}
						</p>
						<button
							type="button"
							onclick={cancel}
							disabled={starting || cancelling}
							class="h-7 shrink-0 rounded-lg border border-line bg-surface px-2.5 text-[11.5px] font-medium text-muted hover:border-del/50 hover:text-del disabled:opacity-40"
							>{cancelling ? 'Canceling…' : 'Cancel'}</button
						>
					</div>
					{#if tools.length}
						<ul
							class="mt-3 flex max-h-28 flex-col gap-1 overflow-hidden rounded-lg border border-line bg-surface px-3 py-2"
							aria-label="Recent generation activity"
						>
							{#each tools as tool, i (i)}
								<li
									class={[
										'truncate font-mono text-[10.5px]',
										i === tools.length - 1 ? 'text-fg' : 'text-faint'
									]}
								>
									<ToolText text={tool} />
								</li>
							{/each}
						</ul>
					{/if}
					<p class="mt-2 text-[11px] text-faint">
						You can switch tabs. Generation keeps running in the background.
					</p>
				</div>
			{/if}

			{#if failure}
				<div
					class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3"
					role="alert"
				>
					<p class="min-w-0 flex-1 text-[12px] text-del">{failure}</p>
					{#if !range}
						<button
							type="button"
							onclick={load}
							class="h-7 shrink-0 rounded-lg border border-line px-2.5 text-[11.5px] font-medium text-muted hover:text-fg"
							>Retry loading</button
						>
					{:else if explainer && !generating}
						<button
							type="button"
							onclick={generate}
							disabled={!canGenerate}
							class="h-7 shrink-0 rounded-lg border border-line px-2.5 text-[11.5px] font-medium text-muted hover:text-fg disabled:opacity-40"
							>Try again</button
						>
					{/if}
				</div>
			{/if}

			{#if explainer}
				<div
					class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line bg-subtle/40 px-5 py-2 text-[10.5px] text-faint"
				>
					<p>Use the scene controls to explore. Drag to orbit · scroll to zoom.</p>
					<span class="font-mono">{explainer.start.slice(0, 7)}..{explainer.stop.slice(0, 7)}</span>
				</div>
				<iframe
					srcdoc={preview}
					title={explainer.title}
					sandbox="allow-scripts"
					referrerpolicy="no-referrer"
					class="block h-[calc(100dvh-18rem)] min-h-[24rem] w-full border-0 bg-white"
				></iframe>
			{/if}
		</section>
	{/if}
</main>

{#snippet focusField()}
	<label for={focusId} class="mb-1.5 block text-[12px] font-medium"
		>Focus <span class="font-normal text-faint">(optional)</span></label
	>
	<textarea
		id={focusId}
		bind:value={focus}
		rows="2"
		maxlength="2000"
		disabled={generating || !hasChanges}
		placeholder="For example: explain how the data moves, or focus on the caching changes."
		class="block w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] leading-relaxed placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-50"
	></textarea>
{/snippet}
