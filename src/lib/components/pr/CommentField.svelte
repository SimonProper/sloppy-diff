<script module lang="ts">
	/** another way to send what's typed, a quiet button beside the send one */
	export interface Action {
		label: string;
		title: string;
		/** the colour it takes on hover */
		tone?: string;
		run: (body: string) => Promise<unknown>;
	}
</script>

<script lang="ts">
	import { errorText } from '$lib/errors';
	import { readJson, readText, writeText } from '$lib/storage';
	import AskField from '../ask/AskField.svelte';
	import Editor from '../ask/Editor.svelte';
	import Avatar from './Avatar.svelte';
	import CommentEditor from './CommentEditor.svelte';

	interface Props {
		/** a reply to a thread or a comment on the pull request, done once it's in the page */
		onsend: (body: string) => Promise<unknown>;
		/** given, sending can start a pending review instead, beside sending it at once */
		onreview?: (body: string) => Promise<unknown>;
		/** where what's typed is kept until it's sent, and a send that failed, through a reload */
		keep: string;
		/** yours: given, the field is a row among the thread's comments, one line until it wraps */
		avatar?: string;
		placeholder?: string;
		/** what sending does, for its button */
		action?: string;
		hint?: string;
		/** given, each sent comment is a card of its own, and the field the next one: on the
		 * conversation, where a comment isn't a reply to the one before */
		card?: string;
		/** more ways to send what's typed, quiet buttons beside the send one; they work empty too */
		actions?: Action[];
	}

	let {
		onsend,
		onreview,
		keep,
		avatar,
		placeholder = avatar === undefined ? 'Reply' : 'Leave a reply…',
		action: given,
		hint: givenHint,
		card,
		actions = []
	}: Props = $props();

	// without a choice, a reply goes to the review in progress
	const action = $derived(given ?? (onreview ? 'Reply' : 'Add to your review'));
	const hint = $derived(givenHint ?? (onreview ? '⌘↵ to reply' : '⌘↵ to add to your review'));

	/** sent, shown under the comments until it's in them; one that failed is open to edit */
	interface Sent {
		id: string;
		body: string;
		/** to your pending review, not at once */
		review?: boolean;
		/** one of `actions`, by its label */
		action?: string;
		failure?: string;
	}

	const key = $derived(`sloppy-diff:reply:${keep}`);
	const failedKey = $derived(`sloppy-diff:reply-failed:${keep}`);
	let reply = $derived(readText(key) ?? '');
	$effect(() => writeText(key, reply.trim() ? reply : null));
	let sent = $derived(readJson<Sent[]>(failedKey, []));
	$effect(() => {
		const failed = sent.filter((s) => s.failure);
		writeText(failedKey, failed.length ? JSON.stringify(failed) : null);
	});
	const typed = $derived(reply.trim().length > 0);

	// the field is free again at once, for the next one
	function send(body: string, review = false, action?: string) {
		reply = '';
		post({ id: crypto.randomUUID(), body, review, action });
	}

	async function post(item: Sent) {
		sent = sent.some((s) => s.id === item.id)
			? sent.map((s) => (s.id === item.id ? item : s))
			: [...sent, item];
		try {
			const run = item.action
				? actions.find((a) => a.label === item.action)?.run
				: item.review && onreview
					? onreview
					: onsend;
			if (!run) throw new Error(`${item.action} isn't offered here any more`);
			await run(item.body);
			sent = sent.filter((s) => s.id !== item.id);
		} catch (e) {
			sent = sent.map((s) => (s.id === item.id ? { ...s, failure: errorText(e) } : s));
		}
	}
</script>

{#snippet startReview()}
	<button
		type="button"
		class="shrink-0 self-end rounded-md px-1.5 text-[11px] leading-5 text-muted hover:bg-subtle hover:text-fg"
		title="Adds it to a new pending review, only you see it until you finish the review"
		onclick={() => send(reply.trim(), true)}>Start a review</button
	>
{/snippet}

<div class={card ? 'flex flex-col gap-3' : [avatar !== undefined && 'divide-y divide-line']}>
	{#each sent as item (item.id)}
		<div
			class={[
				'flex items-start gap-2',
				card,
				avatar === undefined ? 'mb-3' : card ? 'px-3.5 py-3' : 'px-3 py-2'
			]}
		>
			{#if avatar !== undefined}<Avatar src={avatar} class="mt-0.5 size-4" />{/if}
			<div class="min-w-0 flex-1">
				{#if item.failure}
					<CommentEditor
						body={item.body}
						failure="Not sent: {item.failure}"
						action="Retry"
						cancel="Discard"
						onsave={(body) => post({ ...item, body, failure: undefined })}
						oncancel={() => (sent = sent.filter((s) => s.id !== item.id))}
					/>
				{:else}
					{#if item.body}
						<p class="text-[12px] leading-5 whitespace-pre-wrap text-muted">{item.body}</p>
					{/if}
					<p class="text-[11px] text-faint">{item.action ? `${item.action}…` : 'Sending…'}</p>
				{/if}
			</div>
		</div>
	{/each}
	{#if avatar === undefined}
		<AskField
			bind:value={reply}
			{placeholder}
			hints={['', hint]}
			{action}
			people
			onsend={send}
			trailing={onreview && typed ? startReview : undefined}
		/>
	{:else}
		<div class={['flex items-start gap-2 px-3 py-2', card]}>
			<Avatar src={avatar} class="mt-0.5 size-4" />
			<!-- one line until the text wraps, then up to six, as AskField grows -->
			<Editor
				bind:value={reply}
				{placeholder}
				people
				onsend={() => typed && send(reply.trim())}
				class="max-h-[min(50vh,480px)] min-w-0 flex-1 overflow-y-auto text-[12px] leading-5 text-fg"
			/>
			{#if onreview && typed}{@render startReview()}{/if}
			{#each actions as a (a.label)}
				<button
					type="button"
					class={[
						'shrink-0 self-end rounded-md px-1.5 text-[11px] leading-5 text-muted hover:bg-subtle',
						a.tone ?? 'hover:text-fg'
					]}
					title={a.title}
					onclick={() => send(reply.trim(), false, a.label)}>{a.label}</button
				>
			{/each}
			<button
				type="button"
				class={[
					'grid size-5 shrink-0 place-items-center self-end rounded-full transition-colors',
					typed ? 'bg-ink text-surface' : 'pointer-events-none bg-subtle text-muted'
				]}
				aria-label={action}
				title="{action}  ⌘↵"
				disabled={!typed}
				onclick={() => send(reply.trim())}
			>
				<svg
					viewBox="0 0 16 16"
					class="size-2.5"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M8 12.5v-9M4 7l4-4 4 4" /></svg
				>
			</button>
		</div>
	{/if}
</div>
