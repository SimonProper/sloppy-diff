<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Threads } from '$lib/ask/threads.svelte';
	import type { Anchor, Message, ShownSuggestion, Thread } from '$lib/ask/types';
	import { errorText } from '$lib/errors';
	import AskField from './AskField.svelte';
	import StreamText from './StreamText.svelte';
	import Trail from './Trail.svelte';

	interface Props {
		threads: Threads;
		thread: Thread;
		/** the section or file the lines are in */
		title: string;
		/** a second, quieter line under the title */
		detail?: string;
		/** the title shows the lines in the diff when clicked */
		onreveal?: () => void;
		/** a suggested comment's Jump shows its lines, or its file, in the diff */
		onjump?: (anchor: Anchor) => void;
		/** buttons before the title */
		leading?: Snippet;
		/** more buttons at the end of the header */
		actions?: Snippet;
	}

	let { threads, thread, title, detail, onreveal, onjump, leading, actions }: Props = $props();

	const live = $derived(threads.live[thread.id]);
	const lost = $derived(threads.lost[thread.id] ?? false);
	const cost = $derived(thread.messages.reduce((sum, m) => sum + (m.cost ?? 0), 0));
	/** where Delete sits: beside Copy, or Retry, under the first answer */
	const firstAnswer = $derived(thread.messages.findIndex((m) => m.role === 'assistant'));

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

	const tokens = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`);

	function meta(message: Message): string {
		return [
			message.model?.replace(/\[.*\]$/, ''),
			message.durationMs !== undefined && seconds(message.durationMs),
			message.cost !== undefined && money(message.cost)
		]
			.filter(Boolean)
			.join(' · ');
	}

	/** what was just copied: an answer by its index, or one of its suggestions as `i.n` */
	let copied = $state<string | null>(null);
	async function copy(text: string, key: string) {
		await navigator.clipboard.writeText(text).catch(() => {});
		copied = key;
		setTimeout(() => (copied = null), 1200);
	}

	/** Where a suggested comment goes, labelled like a thread's lines. */
	function where(suggestion: ShownSuggestion): string {
		if (suggestion.kind === 'reply') return 'reply to a review thread';
		if (suggestion.line === undefined) return 'whole file';
		const { line, startLine } = suggestion;
		const lines = startLine ? `lines ${startLine}–${line}` : `line ${line}`;
		return suggestion.side === 'old' ? `${lines}, old side` : lines;
	}

	// follow the answer as it streams, unless the reader scrolled up to read. The lens
	// makes a new one of these for each question, so it starts at the bottom
	let body = $state<HTMLElement>();
	let pinned = true;
	let shown = $state(0);
	$effect(() => {
		void thread.messages.length;
		void shown;
		void live?.steps.length;
		void live?.steps.at(-1)?.text.length;
		if (body && pinned) body.scrollTop = body.scrollHeight;
	});
</script>

{#snippet spent()}
	{#if cost > 0 || thread.sessionTokens}
		<span class="shrink-0 tabular-nums" title="What this conversation holds and has cost so far"
			>{[thread.sessionTokens && `${tokens(thread.sessionTokens)} tokens`, cost > 0 && money(cost)]
				.filter(Boolean)
				.join(' · ')}</span
		>
	{/if}
{/snippet}

{#snippet deleting()}
	{#if confirming}
		<button
			type="button"
			class="rounded-md bg-del/10 px-1.5 font-medium text-del hover:bg-del/15"
			onclick={remove}
			onblur={() => (confirming = false)}
			{@attach (el) => el.focus()}>Delete question</button
		>
	{:else}
		<button type="button" class="hover:text-del" onclick={() => (confirming = true)}>Delete</button>
	{/if}
{/snippet}

{#snippet heading()}
	<span class="max-w-full truncate leading-4 font-medium" {title}>{title}</span>
	{#if detail}
		<span class="max-w-full truncate text-[11px] leading-4 text-muted tabular-nums">{detail}</span>
	{/if}
{/snippet}

<section class="flex min-h-0 min-w-0 flex-col bg-surface">
	<header class="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
		{@render leading?.()}
		{#if onreveal}
			<button
				type="button"
				class="-ml-1.5 flex min-w-0 flex-col items-start rounded-md px-1.5 py-0.5 text-left hover:bg-subtle"
				title="Show these lines in the diff"
				onclick={onreveal}
			>
				{@render heading()}
			</button>
		{:else}
			<div class="flex min-w-0 flex-col">{@render heading()}</div>
		{/if}
		<span class="flex-1"></span>
		{@render actions?.()}
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
							{#if i === firstAnswer}<span class="text-[11px] text-faint">{@render deleting()}</span
								>{/if}
						</p>
					{:else}
						<div class="prose text-[13.5px] leading-relaxed">{@html message.html}</div>
						{#if message.suggestions}
							<ol class="mt-3 flex flex-col gap-2">
								{#each message.suggestions as suggestion, n (n)}
									{@const key = `${i}.${n}`}
									<li class="rounded-[10px] border border-line px-3 pt-2 pb-2.5">
										<p class="flex items-center gap-2 text-[11px] text-faint">
											<span class="tabular-nums">#{n + 1}</span>
											{#if suggestion.kind === 'review'}
												<span class="min-w-0 truncate font-medium text-fg" title={suggestion.path}
													>{suggestion.path}</span
												>
											{/if}
											<span class="shrink-0 tabular-nums">{where(suggestion)}</span>
											<span class="flex-1"></span>
											{#if suggestion.kind === 'review' && onjump}
												<button
													type="button"
													class="shrink-0 hover:text-fg"
													onclick={() =>
														onjump({
															path: suggestion.path,
															label: where(suggestion),
															code: '',
															...suggestion.span
														})}>{suggestion.span ? 'Jump to lines' : 'Jump to file'}</button
												>
											{/if}
											<button
												type="button"
												class="shrink-0 hover:text-fg"
												onclick={() => copy(suggestion.body, key)}
												>{copied === key ? 'Copied' : 'Copy'}</button
											>
										</p>
										<div class="prose mt-1.5 text-[13px] leading-relaxed">
											{@html suggestion.html}
										</div>
									</li>
								{/each}
							</ol>
						{/if}
						<p class="mt-2.5 flex items-center gap-2 text-[11px] text-faint">
							{meta(message)}
							<button type="button" class="hover:text-fg" onclick={() => copy(message.text, `${i}`)}
								>{copied === `${i}` ? 'Copied' : 'Copy'}</button
							>
							{#if i === firstAnswer}{@render deleting()}{/if}
						</p>
					{/if}
				</div>
			{/if}
		{/each}

		{#if live}
			<div class="mt-3.5">
				<Trail steps={live.steps} {live} {now} preferOpen={threads.trailOpen} />
				{#if live.text}
					<StreamText text={live.text} bind:shown />
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

	<!-- the follow-up field, send turns to stop while Claude answers -->
	<div class="shrink-0 px-3.5 pt-1 pb-3.5" data-followup>
		<AskField
			bind:value={() => threads.replies[thread.id] ?? '', (v) => (threads.replies[thread.id] = v)}
			placeholder="Follow up"
			hints={['', '↵ to send']}
			busy={sending || !!live}
			onsend={(text) => send(text)}
			onstop={live ? () => threads.cancel(thread.id) : undefined}
			trailing={spent}
		/>
		{#if failure}
			<p class="px-2.5 pt-1.5 text-[12px] text-del">{failure}</p>
		{/if}
	</div>
</section>
