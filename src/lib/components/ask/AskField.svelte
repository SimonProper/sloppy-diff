<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		value: string;
		placeholder: string;
		/** a quiet hint beside send: while empty, and once something's typed */
		hints: [string, string];
		/** what the question is about, shown inline before the text */
		context?: string;
		/** a question is being sent */
		busy?: boolean;
		/** `background` asks without opening the lens (⌘↵) */
		onsend: (text: string, background: boolean) => void;
		onescape?: () => void;
		autofocus?: boolean;
		/** frameless, when it sits in a floating shell that has the border */
		bare?: boolean;
		/** after what it's about, before the hint and send */
		trailing?: Snippet;
		/** Claude is answering: send becomes stop */
		onstop?: () => void;
	}

	let {
		value = $bindable(),
		placeholder,
		hints,
		context,
		busy = false,
		onsend,
		onescape,
		autofocus = false,
		bare = false,
		trailing,
		onstop
	}: Props = $props();

	let textarea: HTMLTextAreaElement;
	const typed = $derived(value.trim().length > 0);

	// one line until the text wraps, then up to six. A field that isn't laid out yet, like
	// one in a popover about to open, measures nothing and keeps its one line
	$effect(() => {
		void value;
		textarea.style.height = '';
		if (textarea.scrollHeight > textarea.clientHeight) {
			textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
		}
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			if (typed && !busy) onsend(value.trim(), event.metaKey || event.ctrlKey);
		} else if (event.key === 'Escape' && onescape) {
			event.preventDefault();
			event.stopPropagation();
			onescape();
		}
	}
</script>

<!-- the text on top, and under it a row inside the box: what it's about and the hint on
     the left, send on the right, however many lines the text grows to -->
<div
	class={[
		'field flex flex-col gap-2 rounded-xl px-3 pt-2.5 pb-2 transition-colors',
		bare ? 'border border-transparent' : 'framed border'
	]}
>
	<textarea
		bind:this={textarea}
		bind:value
		rows="1"
		{placeholder}
		class="h-[22px] max-h-[132px] min-h-[22px] min-w-0 resize-none border-0 bg-transparent p-0 text-[13.5px] leading-[22px] text-fg outline-none placeholder:text-[color-mix(in_oklab,var(--fg)_50%,transparent)]"
		{onkeydown}
		{@attach (el) => {
			if (!autofocus) return;
			// after the popover it may sit in has opened, a hidden field can't take focus
			const frame = requestAnimationFrame(() => el.focus({ preventScroll: true }));
			return () => cancelAnimationFrame(frame);
		}}></textarea>
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
			aria-label={onstop ? 'Stop' : 'Ask'}
			title={onstop ? 'Stop  ⌘.' : 'Ask  ↵'}
			disabled={onstop ? false : !typed || busy}
			onclick={() => (onstop ? onstop() : onsend(value.trim(), false))}
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
