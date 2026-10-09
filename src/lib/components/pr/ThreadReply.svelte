<script lang="ts">
	import { errorText } from '$lib/errors';
	import AskField from '../ask/AskField.svelte';

	interface Props {
		/** the thread replied to, its node id */
		thread: string;
		/** adds the reply to your pending review */
		onreply: (thread: string, body: string) => Promise<unknown>;
		autofocus?: boolean;
		onescape?: () => void;
	}

	let { thread, onreply, autofocus, onescape }: Props = $props();

	let reply = $state('');
	let sending = $state(false);
	let failure = $state('');

	async function send(body: string) {
		sending = true;
		failure = '';
		try {
			await onreply(thread, body);
			reply = '';
		} catch (e) {
			failure = errorText(e);
		} finally {
			sending = false;
		}
	}
</script>

<AskField
	bind:value={reply}
	placeholder="Reply"
	hints={['', '↵ to add to your review']}
	busy={sending}
	onsend={send}
	{autofocus}
	{onescape}
/>
{#if failure}
	<p class="px-2.5 pt-1.5 text-[12px] text-del">{failure}</p>
{/if}
