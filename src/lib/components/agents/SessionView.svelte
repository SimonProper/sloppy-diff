<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import AskField from '$lib/components/ask/AskField.svelte';
	import StreamText from '$lib/components/ask/StreamText.svelte';
	import AgentPickers from './AgentPickers.svelte';
	import RainOrb from '$lib/components/rain-orb/RainOrb.svelte';
	import Band from './Band.svelte';
	import {
		answerApproval,
		changeMode,
		changeEffort,
		changeModel,
		followSession,
		seeSession,
		forkAndSendMessage,
		sendMessage,
		stopAgent,
		stopTurn
	} from '$lib/agents/agents.remote';
	import { untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicIn, cubicOut } from 'svelte/easing';
	import { buttonClass } from '$lib/components/Button.svelte';
	import { drafts } from '$lib/agents/drafts.svelte';
	import { foldSteps, summarize, type Step } from '$lib/agents/steps';
	import { cyclesMode, nextMode, type Item, type Task } from '$lib/agents/types';
	import { errorText } from '$lib/errors';
	import { createMarkdown } from '$lib/markdown';

	interface Props {
		repo: string;
		id: string;
		branch: string;
		/** where Review changes goes: the worktree's branch once it has commits, else uncommitted */
		review: string;
		/** a fork of the session was made to carry on in */
		onfork: (id: string) => void;
	}

	let { repo, id, branch, review, onfork }: Props = $props();

	const markdown = createMarkdown();
	let failure = $state('');
	let sending = $state(false);
	// kept per session, there again on coming back to it
	let draft = $derived.by(() => drafts[id] ?? '');
	$effect(() => {
		const typed = draft;
		untrack(() => (drafts[id] = typed));
	});

	// the session as the server has it, again with each change. Read where it's shown, so Kit
	// closes the stream when it isn't, a quiet session's too
	const live = $derived(followSession({ repo, id }));
	const session = $derived(live.current ?? null);
	$effect(() => {
		if (live.error) failure = errorText(live.error);
	});

	// a turn that ended while it's on screen was seen, the sidebar's check clears
	let seenDone = 0;
	$effect(() => {
		const done = session?.doneAt ?? 0;
		if (done <= (session?.seenAt ?? 0) || done === seenDone || document.hidden) return;
		seenDone = done;
		seeSession({ repo, id }).catch(() => {});
	});

	const running = $derived(session?.status === 'running' || session?.status === 'starting');
	const open = $derived(!!session && session.status !== 'closed');

	/** sent while it worked, not taken up yet: shown above the field, not in the turn going on */
	const queued = $derived(
		(session?.items ?? []).filter(
			(i): i is Extract<Item, { type: 'user' }> => i.type === 'user' && !!i.queued
		)
	);
	/** a message with what the agent did about it, until the next one, its steps folded */
	const turns = $derived.by(() => {
		const out: { user?: Extract<Item, { type: 'user' }>; items: Item[] }[] = [];
		for (const item of session?.items ?? []) {
			if (item.type === 'user' && item.queued) continue;
			if (item.type === 'user') out.push({ user: item, items: [] });
			else (out.at(-1) ?? out[out.push({ items: [] }) - 1]).items.push(item);
		}
		return out.map((turn) => ({ user: turn.user, shown: foldSteps(turn.items) }));
	});
	/**
	 * Where each item is in the session, and how many there were when it was opened: what came
	 * after arrived while it's on screen, and fades in however much of it came at once.
	 */
	const order = $derived(new Map(session?.items.map((item, i) => [item, i])));
	let opened: number | undefined;
	// counted as the session first comes, before it's drawn: a new one's first answer is new too
	$effect.pre(() => {
		if (opened === undefined && session) opened = session.items.length;
	});
	const arrived = (item: Item) => opened !== undefined && (order.get(item) ?? 0) >= opened;
	const lastItem = $derived(session?.items.findLast((i) => !(i.type === 'user' && i.queued)));

	async function act(work: () => Promise<unknown>) {
		failure = '';
		try {
			await work();
		} catch (e) {
			failure = errorText(e);
		}
	}

	/** how long ago another Claude Code wrote to the session, when a message waits on that */
	let busy = $state<number | null>(null);

	/** a message sent, shown at once rather than when the server has it, t3code's way */
	let outgoing = $state<string | null>(null);

	async function send(text: string, force = false) {
		sending = true;
		// a new turn's message shows straight away, one queued mid-turn goes above the field
		if (!running) {
			outgoing = text;
			sentAt = now = Date.now();
		}
		draft = '';
		await act(async () => {
			const sent = await sendMessage({ repo, id, text, force });
			busy = sent.busy ?? null;
			if (busy !== null) draft = text;
		});
		if (failure) draft = text;
		if (failure || busy !== null) outgoing = null;
		sending = false;
	}
	// the server's copy of it is in once the turn is under way
	$effect(() => {
		if (outgoing !== null && running) outgoing = null;
	});
	// should no turn come of it, it doesn't wait there for ever
	$effect(() => {
		if (outgoing === null) return;
		const timer = setTimeout(() => (outgoing = null), 10_000);
		return () => clearTimeout(timer);
	});

	/** its subagents while they run, the background ones after its turn too */
	const tasks = $derived(session?.tasks ?? []);
	const taskOf = (id: string) => tasks.find((t) => t.toolUseId === id);
	const doing = (task: Task) =>
		task.doing ? `${task.description}: ${task.doing}` : task.description;
	/**
	 * The turn being worked on, one row at the end that stays from the send to the turn's end,
	 * as t3code's working row: what it's on changes in it, it doesn't come and go. After it, the
	 * subagents left working in the background.
	 */
	const working = $derived(running || outgoing !== null || tasks.length > 0);
	/**
	 * What it's on, after the row's "Working for 12s", which never changes: none of t3code, Codex
	 * or Claude Code name a start, only a slow one is said, nono or a long session resuming.
	 * Null when it waits on you.
	 */
	const activity = $derived.by((): string | null => {
		// the turn's over, the row's for what's left in the background
		if (!running && tasks.length) return tasks.length === 1 ? doing(tasks[0]) : '';
		if (session?.status === 'starting' || !running) {
			return now - startedAt > 3000 ? 'starting Claude Code' : '';
		}
		const last = session?.items.findLast((i) => !(i.type === 'user' && i.queued));
		if (last?.type === 'approval' && !last.decision) return null;
		if (last?.type === 'tool' && !last.done) {
			// several at once would swap too fast to read
			const waitedOn = tasks.filter((t) => !t.background).length;
			if (waitedOn > 1) return `${waitedOn} agents running`;
			const task = taskOf(last.id);
			return task ? doing(task) : `${last.name} ${last.title}`.trim();
		}
		if (last?.type === 'thinking') return 'Thinking';
		if (last?.type === 'text') return 'Writing';
		return '';
	});
	/** when the turn started: its message's time, or the send's before the server has it */
	let sentAt = $state(0);
	const startedAt = $derived.by(() => {
		const asked = session?.items.findLast((i) => i.type === 'user' && !i.queued);
		return running && asked?.type === 'user' && asked.at ? Date.parse(asked.at) : sentAt;
	});
	let now = $state(Date.now());
	$effect(() => {
		if (!working) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	/** Sends in a copy of the session instead, the one open elsewhere is left alone. */
	async function fork() {
		sending = true;
		await act(async () => {
			const copy = await forkAndSendMessage({ repo, id, text: draft.trim() });
			busy = null;
			draft = '';
			onfork(copy);
		});
		sending = false;
	}

	const stop = () => act(() => stopTurn({ repo, id }));
	/** the turn's over, its subagents left working in the background */
	const background = $derived(!running && outgoing === null && tasks.length > 0);
	/** the agents asked to stop, their buttons off until Claude Code says they have */
	let stopping = $state<string[]>([]);
	async function stopTask(taskId: string) {
		stopping = [...stopping, taskId];
		await act(() => stopAgent({ repo, id, taskId }));
		if (failure) stopping = stopping.filter((t) => t !== taskId);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.metaKey && event.key === '.' && running) {
			event.preventDefault();
			stop();
		}
	}

	const seconds = (ms?: number) => `${Math.max(1, Math.round((ms ?? 0) / 1000))}s`;
	/** the detail's swap, none where motion is reduced */
	const swap =
		typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
			? 0
			: 180;

	/** "12s", "2m 5s", as t3code times a turn */
	const elapsed = (ms: number) => {
		const s = Math.max(1, Math.floor(ms / 1000));
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
	};
	const money = (usd: number) => (usd < 0.001 ? '<$0.001' : `$${usd.toFixed(usd < 0.1 ? 3 : 2)}`);
	const tokens = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`);

	// the page follows the end while the reader is there, scrolling up stops that until they're back
	let following = true;
	const atEnd = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 24;
</script>

<svelte:window {onkeydown} onscroll={() => (following = atEnd())} />

{#snippet diffLines(text: string)}
	<pre
		class="overflow-x-auto font-mono text-[11.5px] leading-[1.55]">{#each text.split('\n') as line, n (n)}<span
				class={[
					'block px-2',
					line.startsWith('+')
						? 'bg-add/12 text-add'
						: line.startsWith('-')
							? 'bg-del/12 text-del'
							: ''
				]}>{line || ' '}</span
			>{/each}</pre>
{/snippet}

{#snippet stopButton(task: Task)}
	<button
		type="button"
		class={buttonClass({ variant: 'danger', size: 'xs' })}
		disabled={stopping.includes(task.id)}
		aria-label="Stop {task.description}"
		onclick={() => stopTask(task.id)}>Stop</button
	>
{/snippet}

{#snippet tool(item: Extract<Item, { type: 'tool' }>)}
	{@const task = taskOf(item.id)}
	<details class="group rounded-lg border border-line bg-surface text-[12px]">
		<summary class="flex h-8 cursor-pointer list-none items-center gap-2 px-2.5 select-none">
			{#if !item.done}
				<span
					class="spin size-3 shrink-0 rounded-full border-[1.5px] border-ink-soft/40 border-t-ink"
				></span>
			{:else}
				<span class={['size-1.5 shrink-0 rounded-full', item.failed ? 'bg-del' : 'bg-add']}></span>
			{/if}
			<span class="shrink-0 font-medium">{item.name}</span>
			<span class="min-w-0 truncate font-mono text-[11.5px] text-muted" title={item.title}
				>{item.title}</span
			>
			<!-- a subagent's, while it runs: its summary, else its last tool -->
			{#if task?.doing}
				<span class="min-w-0 shrink-[2] truncate text-faint" title={task.doing}>· {task.doing}</span
				>
			{/if}
			<svg
				viewBox="0 0 16 16"
				class="ml-auto size-3 shrink-0 text-faint transition-transform group-open:rotate-90"
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg
			>
		</summary>
		<div class="flex flex-col gap-2 border-t border-line py-2">
			{#if item.detail}
				{#if item.name === 'Edit'}
					<div class="max-h-72 overflow-auto">{@render diffLines(item.detail)}</div>
				{:else}
					<pre
						class="overflow-x-auto px-2.5 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap">{item.detail}</pre>
				{/if}
			{/if}
			{#if item.output}
				<pre
					class={[
						'max-h-72 overflow-auto px-2.5 font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap',
						item.failed ? 'text-del' : 'text-muted'
					]}>{item.output}</pre>
			{:else if item.done && !item.detail}
				<p class="px-2.5 text-faint">No output</p>
			{/if}
		</div>
	</details>
{/snippet}

<!-- a run of tool calls and thinking as one line: what it's on while it works, what it did
     once it's done, open for each step -->
<!-- what it's on now is in the working row, the group only sums up -->
{#snippet steps(list: Step[])}
	{@const failed = list.filter((s) => s.type === 'tool' && s.failed).length}
	<details class="group/steps text-[12px]">
		<summary
			class="flex h-7 max-w-full cursor-pointer list-none items-center gap-2 text-muted select-none hover:text-fg"
		>
			<svg
				viewBox="0 0 16 16"
				class="size-3 shrink-0 transition-transform group-open/steps:rotate-90"
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				stroke-linecap="round"
				stroke-linejoin="round"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg
			>
			<span class="min-w-0 truncate">{summarize(list)}</span>
			{#if failed}<span class="shrink-0 text-del">· {failed} failed</span>{/if}
		</summary>
		<div class="mt-1 mb-1 ml-1.5 flex flex-col gap-1.5 border-l-2 border-line pl-3">
			{#each list as step, n (n)}
				{#if step.type === 'tool'}
					{@render tool(step)}
				{:else}
					<p class="text-[12px] whitespace-pre-wrap text-muted italic">{step.text}</p>
				{/if}
			{/each}
		</div>
	</details>
{/snippet}

{#snippet approval(item: Extract<Item, { type: 'approval' }>)}
	<div
		class={[
			'rounded-xl border p-3 text-[12.5px]',
			item.decision ? 'border-line' : 'border-accent/50 bg-accent/5'
		]}
	>
		<p class="flex items-center gap-2">
			<span class="font-medium"
				>{item.tool === 'ExitPlanMode' ? 'Start on this plan?' : `Allow ${item.tool}?`}</span
			>
		</p>
		{#if item.title && !item.detail}
			<!-- all of it, what's allowed shouldn't be cut short -->
			<pre
				class="mt-1.5 font-mono text-[11.5px] break-all whitespace-pre-wrap text-muted">{item.title}</pre>
		{:else if item.title}
			<p class="mt-1 font-mono text-[11.5px] break-all text-muted">{item.title}</p>
		{/if}
		{#if item.plan}
			<div class="prose mt-2 max-h-96 overflow-auto text-[13px]">
				{@html markdown.render(item.plan)}
			</div>
		{:else if item.detail}
			<div class="mt-2 max-h-72 overflow-auto rounded-md border border-line bg-surface py-1.5">
				{#if item.tool === 'Edit'}
					{@render diffLines(item.detail)}
				{:else}
					<pre class="px-2.5 font-mono text-[11.5px] whitespace-pre-wrap">{item.detail}</pre>
				{/if}
			</div>
		{/if}
		<div class="mt-2.5 flex items-center gap-2">
			{#if item.decision}
				<span class="text-[11.5px] text-muted">
					{item.decision === 'deny'
						? 'Denied'
						: item.decision === 'always'
							? 'Always allowed'
							: 'Allowed'}
				</span>
			{:else if !open}
				<span class="text-[11.5px] text-muted">The session ended before this was answered</span>
			{:else}
				<Button
					variant="solid"
					size="sm"
					onclick={() =>
						act(() => answerApproval({ repo, id, approval: item.id, decision: 'allow' }))}
					>{item.tool === 'ExitPlanMode' ? 'Start' : 'Allow'}</Button
				>
				{#if item.tool !== 'ExitPlanMode'}
					<Button
						size="sm"
						title="Allows calls like this one for the rest of the session"
						onclick={() =>
							act(() => answerApproval({ repo, id, approval: item.id, decision: 'always' }))}
						>Always allow</Button
					>
				{/if}
				<Button
					variant="danger"
					size="sm"
					onclick={() =>
						act(() => answerApproval({ repo, id, approval: item.id, decision: 'deny' }))}
					>{item.tool === 'ExitPlanMode' ? 'Keep planning' : 'Deny'}</Button
				>
			{/if}
		</div>
	</div>
{/snippet}

<!-- as tall as the page under its header, the field at its foot when there's little above it -->
<section class="flex min-h-[calc(100dvh-48px)] flex-col">
	<Band>
		<div class="flex min-w-0 flex-col text-[12px]">
			<span class="truncate leading-4 font-medium">{session?.title ?? '…'}</span>
			<span class="truncate font-mono text-[11px] leading-4 text-muted">{branch}</span>
		</div>
		<span class="flex-1"></span>
		{#if session}
			{#if session.contextTokens || session.cost}
				<span class="shrink-0 text-[11px] text-muted tabular-nums"
					>{[
						session.contextTokens && `${tokens(session.contextTokens)} tokens`,
						session.cost && money(session.cost)
					]
						.filter(Boolean)
						.join(' · ')}</span
				>
			{/if}
			<a
				class={buttonClass({ size: 'sm' })}
				href={review}
				title="Review what the agent changed in this worktree">Review changes</a
			>
		{/if}
	</Band>

	<div class="flex-1">
		<div
			class="page-column flex flex-col gap-2 px-3 pt-4 pb-6"
			style:--cap="48rem"
			{@attach (el) => {
				const observer = new ResizeObserver(() => {
					if (following) scrollTo({ top: document.documentElement.scrollHeight });
				});
				observer.observe(el);
				return () => observer.disconnect();
			}}
		>
			{#each turns as turn, t (turn.user?.id ?? t)}
				{#if turn.user}
					<div
						class={[
							'prose ml-auto w-fit max-w-[85%] rounded-[calc(var(--radius)*1.25)] bg-subtle px-3 py-2 text-[13px] break-words',
							t > 0 && 'mt-5'
						]}
					>
						{@html markdown.render(turn.user.text)}
					</div>
				{/if}
				{#each turn.shown as item, i (i)}
					{#if item.type === 'steps'}
						{@render steps(item.steps)}
					{:else if item.type === 'text' && item.text.trim()}
						<div class="text-[13.5px] leading-relaxed">
							<StreamText
								text={item.text}
								streaming={running && item === lastItem}
								fresh={arrived(item)}
							/>
						</div>
					{:else if item.type === 'approval'}
						{@render approval(item)}
					{:else if item.type === 'turn'}
						<p class="flex items-center gap-2 text-[11px] text-faint tabular-nums">
							{#if item.error}<span class="text-del">{item.error}</span> ·{/if}
							{seconds(item.durationMs)}{#if item.cost}
								· {money(item.cost)}{/if}
						</p>
					{:else if item.type === 'notice'}
						<p class="text-center text-[11.5px] text-muted">{item.text}</p>
					{/if}
				{/each}
			{/each}
			{#if outgoing !== null && !running}
				<div
					class="prose mt-5 ml-auto w-fit max-w-[85%] rounded-[calc(var(--radius)*1.25)] bg-subtle px-3 py-2 text-[13px] break-words"
				>
					{@html markdown.render(outgoing)}
				</div>
			{/if}
			{#if working}
				<!-- one row from the send to the turn's end, what it's on changing in place -->
				<p class="mt-1 flex h-6 items-center gap-2 text-[12px] text-muted" aria-live="polite">
					{#if activity === null}
						<span class="size-1.5 shrink-0 rounded-full bg-mod"></span>
						<span>Waiting for you</span>
					{:else}
						<!-- the rain orb at its inline size, in the row's colour, drawn in a worker -->
						<RainOrb
							size={20}
							label={activity ? `Working: ${activity}` : 'Working'}
							class="-ml-1 text-fg"
						/>
						<span class="shrink-0 tabular-nums"
							>{running || outgoing !== null
								? `Working for ${elapsed(now - startedAt)}`
								: tasks.length === 1
									? 'An agent in the background'
									: `${tasks.length} agents in the background`}</span
						>
						<!-- the old one up and out as the new one comes up from below, in the same place:
						     a grid cell both share while they pass -->
						<span class="grid min-w-0 flex-1 overflow-hidden text-faint">
							{#key activity}
								<span
									class="truncate [grid-area:1/1]"
									in:fly={{ y: 8, duration: swap, easing: cubicOut }}
									out:fly={{ y: -8, duration: swap, easing: cubicIn }}
									>{activity ? `· ${activity}` : ''}</span
								>
							{/key}
						</span>
						{#if background && tasks.length === 1}
							{@render stopButton(tasks[0])}
						{/if}
					{/if}
				</p>
				{#if background && tasks.length > 1}
					<ul class="mb-1 ml-1.5 flex flex-col border-l-2 border-line pl-3 text-[12px] text-muted">
						{#each tasks as task (task.id)}
							<li class="flex h-6 items-center gap-2">
								<span class="min-w-0 flex-1 truncate" title={doing(task)}>{doing(task)}</span>
								{@render stopButton(task)}
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>
	</div>

	<!-- the field floats at the foot of the page, what scrolls under it fading out above it -->
	<div class="sticky bottom-0 z-[16] bg-linear-to-t from-canvas from-70% to-transparent pt-6">
		<div class="page-column px-3 pb-2" style:--cap="48rem">
			{#if busy !== null}
				{@const minutes = Math.round(busy / 60_000)}
				<div class="mb-2 rounded-xl border border-mod/40 bg-mod/8 p-3 text-[12.5px]" role="alert">
					<p>
						This session was used in another Claude Code {minutes < 1
							? 'less than a minute'
							: `${minutes} min`} ago and may still be open there. Sending from both would make them lose
						track of each other.
					</p>
					<div class="mt-2 flex items-center gap-2">
						<Button variant="solid" size="sm" disabled={sending} onclick={fork}
							>Fork and send</Button
						>
						<Button size="sm" disabled={sending} onclick={() => send(draft.trim(), true)}
							>It's closed, send</Button
						>
						<button
							type="button"
							class="ml-auto text-[11.5px] text-muted hover:text-fg"
							onclick={() => (busy = null)}>Cancel</button
						>
					</div>
				</div>
			{/if}
			{#if queued.length}
				<!-- sent while it works, taken up once its turn is over -->
				<ul class="mb-2 flex flex-col gap-1">
					{#each queued as item (item.id)}
						<li
							class="ml-auto flex max-w-[85%] items-start gap-2 rounded-[calc(var(--radius)*1.25)] border border-dashed border-line px-3 py-1.5 text-[12.5px] text-muted"
						>
							<span class="shrink-0 text-[11px] font-medium">Queued</span>
							<span class="min-w-0 truncate">{item.text}</span>
						</li>
					{/each}
				</ul>
			{/if}
			<!-- a card floating over the page, as the diff's question composer is. ⇧⇥ in its text
			     cycles the mode, as in Claude Code -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="rounded-2xl border border-line bg-surface p-1.5 shadow-float"
				onkeydown={(event) => {
					if (!session || !cyclesMode(event)) return;
					event.preventDefault();
					const mode = nextMode(session.mode);
					act(() => changeMode({ repo, id, mode }));
				}}
			>
				<AskField
					bare
					autofocus
					bind:value={draft}
					placeholder={running ? 'Queue a message for the agent' : 'Reply'}
					hints={['', running ? '⌘↵ to queue' : '⌘↵ to send']}
					action="Send"
					busy={sending}
					onsend={send}
					onstop={running && !draft.trim() ? stop : undefined}
				/>
				<!-- how the agent works, under the field it is told what to do in -->
				<div class="mt-1 flex items-center justify-between gap-1.5 px-1.5 pb-0.5">
					{#if session}
						<AgentPickers
							{repo}
							shortcut
							mode={session.mode}
							model={session.model ?? 'default'}
							onmode={(mode) => act(() => changeMode({ repo, id, mode }))}
							effort={session.effort ?? 'default'}
							onmodel={(model) => act(() => changeModel({ repo, id, model }))}
							oneffort={(effort) => act(() => changeEffort({ repo, id, effort }))}
						/>
					{/if}
				</div>
			</div>
			{#if failure}
				<p class="px-2.5 pt-1.5 text-[12px] text-del">{failure}</p>
			{/if}
		</div>
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
</style>
