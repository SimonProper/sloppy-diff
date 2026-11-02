<script lang="ts">
	import type { Snippet } from 'svelte';
	import Editor from './Editor.svelte';

	interface Props {
		value: string;
		placeholder: string;
		/** a quiet hint beside send: while empty, and once something's typed */
		hints: [string, string];
		/** what the question is about, shown inline before the text */
		context?: string;
		/** the extension of the file it's about: a fence's language when it names none, and a
		 * ```suggestion's */
		language?: string;
		/** a question is being sent */
		busy?: boolean;
		/** ⌘↵, or the send button. ↵ alone is a new line */
		onsend: (text: string) => void;
		/** what send does, for its label */
		action?: string;
		/** Tab, to switch what send does */
		ontab?: () => void;
		onescape?: () => void;
		/** `@` offers the pull request's people as well as the diff's files: a comment on it */
		people?: boolean;
		autofocus?: boolean;
		/** frameless, when it sits in a floating shell that has the border */
		bare?: boolean;
		/** after what it's about, before the hint and send */
		trailing?: Snippet;
		/** The agent is answering: send becomes stop */
		onstop?: () => void;
	}

	let {
		value = $bindable(),
		placeholder,
		hints,
		context,
		language,
		busy = false,
		onsend,
		action = 'Ask',
		ontab,
		onescape,
		people = false,
		autofocus = false,
		bare = false,
		trailing,
		onstop
	}: Props = $props();

	const typed = $derived(value.trim().length > 0);
</script>

<!-- the text on top, and under it a row inside the box: what it's about and the hint on
     the left, send on the right, however many lines the text grows to -->
<div
	class={[
		'field flex flex-col gap-2 rounded-[calc(var(--radius-2xl)-8px)] pt-2.5 pr-2 pb-2 pl-3 transition-colors',
		bare ? 'border border-transparent' : 'framed border'
	]}
>
	<!-- one line until the text wraps, growing to half the window, then scrolling -->
	<Editor
		bind:value
		{placeholder}
		{language}
		{people}
		{autofocus}
		{onescape}
		{ontab}
		onsend={() => typed && !busy && onsend(value.trim())}
		class="max-h-[min(50vh,480px)] min-h-[22px] min-w-0 overflow-y-auto text-[13.5px] leading-[22px] text-fg"
	/>
	<div class="flex h-6 items-center gap-2 text-[11px] text-muted">
		{#if context}
			<span class="min-w-0 truncate rounded-md bg-subtle px-1.5 font-mono leading-5">{context}</span
			>
		{/if}
		{@render trailing?.()}
		<span class="flex-1"></span>
		<span class="shrink-0 whitespace-nowrap"
			>{onstop ? '⌘. to stop' : typed ? hints[1] : hints[0]}</span
		>
		<button
			type="button"
			class={[
				'grid size-6 shrink-0 place-items-center rounded-full transition-colors',
				typed || onstop ? 'bg-ink text-surface' : 'pointer-events-none bg-subtle text-muted'
			]}
			aria-label={onstop ? 'Stop' : action}
			title={onstop ? 'Stop  ⌘.' : `${action}  ⌘↵`}
			disabled={onstop ? false : !typed || busy}
			onclick={() => (onstop ? onstop() : onsend(value.trim()))}
		>
			{#if onstop}
				<svg viewBox="0 0 16 16" class="size-2.5" fill="currentColor"
					><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg
				>
			{:else if busy}
				<span class="spin size-3 rounded-full border-[1.5px] border-surface/40 border-t-surface"
				></span>
			{:else}
				<svg
					viewBox="0 0 16 16"
					class="size-3"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M8 12.5v-9M4 7l4-4 4 4" /></svg
				>
			{/if}
		</button>
	</div>
</div>

<style>
	/* lifted a little off the panel, like the prompt boxes of other chat apps */
	.framed {
		background: color-mix(in oklab, var(--fg) 3%, var(--surface));
		border-color: color-mix(in oklab, var(--fg) 12%, var(--line));
	}
	.framed:focus-within {
		border-color: color-mix(in oklab, var(--fg) 26%, var(--line));
	}
	.spin {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
