<script lang="ts">
	import { errorText } from '$lib/errors';
	import { readJson, readText, writeText } from '$lib/storage';
	import AskField from '../ask/AskField.svelte';
	import Avatar from './Avatar.svelte';
	import CommentEditor from './CommentEditor.svelte';

	interface Props {
		/** a reply to a thread or a comment on the pull request, done once it's in the page */
		onsend: (body: string) => Promise<unknown>;
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
	}

	let {
		onsend,
		keep,
		avatar,
		placeholder = avatar === undefined ? 'Reply' : 'Leave a reply…',
		action = 'Add to your review',
		hint = '⌘↵ to add to your review',
		card
	}: Props = $props();

	/** sent, shown under the comments until it's in them; one that failed is open to edit */
	interface Sent {
		id: string;
		body: string;
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
	function send(body: string) {
		reply = '';
		post({ id: crypto.randomUUID(), body });
	}

	async function post(item: Sent) {
		sent = sent.some((s) => s.id === item.id)
			? sent.map((s) => (s.id === item.id ? item : s))
			: [...sent, item];
		try {
			await onsend(item.body);
			sent = sent.filter((s) => s.id !== item.id);
		} catch (e) {
			sent = sent.map((s) => (s.id === item.id ? { ...s, failure: errorText(e) } : s));
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
		event.preventDefault();
		if (typed) send(reply.trim());
	}

	// one line until the text wraps, then up to six, as AskField grows. Runs again as it's typed
	function grow(textarea: HTMLTextAreaElement) {
		void reply;
		textarea.style.height = '';
		if (textarea.scrollHeight > textarea.clientHeight) {
			textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
		}
	}
</script>

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
						onsave={(body) => post({ id: item.id, body })}
						oncancel={() => (sent = sent.filter((s) => s.id !== item.id))}
					/>
				{:else}
					<p class="text-[12px] leading-5 whitespace-pre-wrap text-muted">{item.body}</p>
					<p class="text-[11px] text-faint">Sending…</p>
				{/if}
			</div>
		</div>
	{/each}
	{#if avatar === undefined}
		<AskField bind:value={reply} {placeholder} hints={['', hint]} onsend={send} />
	{:else}
		<div class={['flex items-start gap-2 px-3 py-2', card]}>
			<Avatar src={avatar} class="mt-0.5 size-4" />
			<textarea
				bind:value={reply}
				rows="1"
				{placeholder}
				title={hint}
				class="h-5 min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-[12px] leading-5 text-fg outline-none placeholder:text-faint"
				{onkeydown}
				{@attach grow}></textarea>
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
