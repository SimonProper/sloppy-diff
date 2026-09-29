<script lang="ts">
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { Message, Thread } from '$lib/ask/types';
	import { errorText } from '$lib/errors';
	import AskField from './AskField.svelte';
	import Trail from './Trail.svelte';

	interface Props {
		threads: Threads;
		thread: Thread;
		/** the section or file the lines are in */
		title: string;
	}

	let { threads, thread, title }: Props = $props();

	const live = $derived(threads.live[thread.id]);
	const lost = $derived(threads.lost[thread.id] ?? false);
	const cost = $derived(thread.messages.reduce((sum, m) => sum + (m.cost ?? 0), 0));

	let sending = $state(false);
	let failure = $state('');
	let confirming = $state(false);

	let now = $state(Date.now());
	$effect(() => {
		if (!live) return;
		const timer = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(timer);
	});

	async function send(text: string) {
		sending = true;
		failure = '';
		try {
			await threads.ask(text, thread.id);
		} catch (e) {
			failure = errorText(e);
		} finally {
			sending = false;
		}
	}

	async function retry() {
		failure = '';
		try {
			await threads.retry(thread.id);
		} catch (e) {
			failure = errorText(e);
		}
	}

	async function remove() {
		try {
			await threads.remove(thread.id);
		} catch (e) {
			failure = errorText(e);
		}
	}

	const seconds = (ms?: number) => `${Math.max(1, Math.round((ms ?? 0) / 1000))}s`;
	const money = (usd: number) => (usd < 0.001 ? '<$0.001' : `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`);

	function meta(message: Message): string {
		return [
			message.model?.replace(/\[.*\]$/, ''),
			message.durationMs !== undefined && seconds(message.durationMs),
			message.cost !== undefined && money(message.cost)
		]
			.filter(Boolean)
			.join(' · ');
	}

	let copied = $state<number | null>(null);
	async function copy(message: Message, i: number) {
		await navigator.clipboard.writeText(message.text).catch(() => {});
		copied = i;
		setTimeout(() => (copied = null), 1200);
	}

	// follow the answer as it streams, unless the reader scrolled up to read. The lens
	// makes a new one of these for each question, so it starts at the bottom
	let body = $state<HTMLElement>();
	let pinned = true;
	$effect(() => {
		void thread.messages.length;
		void live?.text.length;
		void live?.steps.length;
		void live?.steps.at(-1)?.text.length;
		if (body && pinned) body.scrollTop = body.scrollHeight;
	});
</script>

<section class="flex min-h-0 min-w-0 flex-col bg-surface">
	<header class="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-3 text-[12px]">
		<span class="min-w-0 truncate font-medium" {title}>{title}</span>
		<span class="flex-1"></span>
		{#if cost > 0}
			<span class="shrink-0 text-[11px] text-faint tabular-nums" title="What this conversation cost"
				>{money(cost)}</span
			>
		{/if}
		{#if confirming}
			<button
				type="button"
				class="h-7 shrink-0 rounded-md bg-del/10 px-2 text-[11.5px] font-medium text-del hover:bg-del/15"
				onclick={remove}
				onblur={() => (confirming = false)}
				{@attach (el) => el.focus()}>Delete question</button
			>
		{:else}
			<button
				type="button"
				class="grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-subtle hover:text-fg"
				title="Delete this question"
				aria-label="Delete this question"
				onclick={() => (confirming = true)}
			>
				<svg
					viewBox="0 0 16 16"
					class="size-3.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" /></svg
				>
			</button>
		{/if}
	</header>

	<div
		bind:this={body}
		class="min-h-0 flex-1 overflow-y-auto px-5 pt-[18px] pb-6"
		onscroll={(e) => {
			const el = e.currentTarget;
			pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
		}}
	>
		{#each thread.messages as message, i (i)}
			{@const last = i === thread.messages.length - 1}
			{#if message.role === 'user'}
				<p
					class={[
						'rounded-[10px] bg-subtle px-3 py-2 text-[13px] leading-normal whitespace-pre-wrap',
						i > 0 && 'mt-[26px]'
					]}
				>
					{message.text}
				</p>
			{:else}
				<div class="mt-3.5">
					<Trail
						steps={message.steps ?? []}
						thinkingMs={message.thinkingMs}
						thinkingTokens={message.thinkingTokens}
						preferOpen={threads.trailOpen}
					/>
					{#if message.error}
						<p class="flex items-center gap-2.5 text-[12px]">
							{#if message.error === 'Cancelled'}
								<span class="text-muted">Stopped after {seconds(message.durationMs)}</span>
							{:else}
								<span class="text-del">Couldn't answer: {message.error}</span>
							{/if}
							{#if last && !live}
								<button
									type="button"
									class="h-6 rounded-md border border-line px-2 text-[11.5px] text-muted hover:border-muted hover:text-fg"
									onclick={retry}>{message.error === 'Cancelled' ? 'Ask again' : 'Retry'}</button
								>
							{/if}
						</p>
					{:else}
						<div class="prose text-[13.5px] leading-relaxed">{@html message.html}</div>
						<p class="mt-2.5 flex items-center gap-2 text-[11px] text-faint">
							{meta(message)}
							<button type="button" class="hover:text-fg" onclick={() => copy(message, i)}
								>{copied === i ? 'Copied' : 'Copy'}</button
							>
						</p>
					{/if}
				</div>
			{/if}
		{/each}

		{#if live}
			<div class="mt-3.5">
				<Trail steps={live.steps} {live} preferOpen={threads.trailOpen} />
				{#if live.text}
					<p class="text-[13.5px] leading-relaxed whitespace-pre-wrap">
						{live.text}<span class="caret"></span>
					</p>
				{/if}
			</div>
		{:else if lost && thread.messages.at(-1)?.role === 'user'}
			<p class="mt-3.5 flex items-center gap-2.5 text-[12px] text-muted">
				This answer was interrupted.
				<button
					type="button"
					class="h-6 rounded-md border border-line px-2 text-[11.5px] hover:border-muted hover:text-fg"
					onclick={retry}>Ask again</button
				>
			</p>
		{/if}
	</div>

	<!-- one place to look: the follow-up field, or while Claude answers, its progress -->
	<div class="shrink-0 px-3.5 pt-1 pb-3.5" data-followup>
		{#if live}
			<div
				class="flex h-9 items-center gap-2 rounded-[10px] border border-line px-2.5 text-[12px] text-muted"
			>
				<span
					class="spin size-3 shrink-0 rounded-full border-[1.5px] border-ink-soft/40 border-t-ink"
				></span>
				<span class="min-w-0 truncate">{live.status}</span>
				<span class="text-faint tabular-nums"
					>· {Math.max(0, Math.round((now - live.startedAt) / 1000))}s</span
				>
				<span class="flex-1"></span>
				<button
					type="button"
					class="h-[22px] shrink-0 rounded-md px-2 text-[11.5px] text-muted hover:bg-subtle hover:text-fg"
					onclick={() => threads.cancel(thread.id)}
					>Stop <kbd class="pl-1 font-mono text-[10.5px] text-faint">⌘.</kbd></button
				>
			</div>
		{:else}
			<AskField
				bind:value={() => threads.replies[thread.id] ?? '', (v) => (threads.replies[thread.id] = v)}
				placeholder="Follow up"
				hints={['same session · ~$0.01', '↵']}
				busy={sending}
				onsend={(text) => send(text)}
			/>
		{/if}
		{#if failure}
			<p class="px-2.5 pt-1.5 text-[12px] text-del">{failure}</p>
		{/if}
	</div>
</section>

<style>
	.spin {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.caret {
		display: inline-block;
		width: 7px;
		height: 1.05em;
		margin-left: 1px;
		vertical-align: -2px;
		background: var(--ink);
		animation: blink 1s steps(1) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
</style>
