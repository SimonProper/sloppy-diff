<script lang="ts">
	import { errorText } from '$lib/errors';
	import AskField from '../ask/AskField.svelte';
	import Avatar from './Avatar.svelte';

	interface Props {
		/** a reply to a thread or a comment on the pull request, emptied once it's sent */
		onsend: (body: string) => Promise<unknown>;
		/** yours: given, the field is a row among the thread's comments, one line until it wraps */
		avatar?: string;
		placeholder?: string;
		/** what sending does, for its button */
		action?: string;
		hint?: string;
	}

	let {
		onsend,
		avatar,
		placeholder = avatar === undefined ? 'Reply' : 'Leave a reply…',
		action = 'Add to your review',
		hint = '↵ to add to your review'
	}: Props = $props();

	let reply = $state('');
	let sending = $state(false);
	let failure = $state('');
	const typed = $derived(reply.trim().length > 0);

	async function send(body: string) {
		sending = true;
		failure = '';
		try {
			await onsend(body);
			reply = '';
		} catch (e) {
			failure = errorText(e);
		} finally {
			sending = false;
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		if (typed && !sending) send(reply.trim());
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

<div>
	{#if avatar === undefined}
		<AskField bind:value={reply} {placeholder} hints={['', hint]} busy={sending} onsend={send} />
	{:else}
		<div class="flex items-start gap-2 px-3 py-2">
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
				title="{action}  ↵"
				disabled={!typed || sending}
				onclick={() => send(reply.trim())}
			>
				{#if sending}
					<span class="spin size-2.5 rounded-full border-[1.5px] border-surface/40 border-t-surface"
					></span>
				{:else}
					<svg
						viewBox="0 0 16 16"
						class="size-2.5"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M8 12.5v-9M4 7l4-4 4 4" /></svg
					>
				{/if}
			</button>
		</div>
	{/if}
	{#if failure}
		<p class={['text-[12px] text-del', avatar === undefined ? 'px-2.5 pt-1.5' : 'pr-3 pb-2 pl-9']}>
			{failure}
		</p>
	{/if}
</div>

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
