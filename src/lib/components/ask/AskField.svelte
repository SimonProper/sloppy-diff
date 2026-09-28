<script lang="ts">
	interface Props {
		value: string;
		placeholder: string;
		/** a quiet hint at the end: while empty, and once something's typed */
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
		bare = false
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

<!-- what it's about on its own line, the text under it, and send at the text's
     bottom right however many lines it grows to -->
<div
	class={[
		'flex flex-col gap-1 rounded-[10px] bg-surface py-1.5 pr-1.5 pl-2 transition-colors',
		bare
			? 'border border-transparent'
			: 'border border-line focus-within:border-[color-mix(in_oklab,var(--fg)_28%,var(--line))]'
	]}
>
	{#if context}
		<div class="flex h-5 items-center gap-2 pr-1">
			<span
				class="min-w-0 truncate rounded-md bg-subtle px-1.5 font-mono text-[11px] leading-5 text-muted"
				>{context}</span
			>
			<span class="flex-1"></span>
			{@render hint()}
		</div>
	{/if}
	<div class="flex items-end gap-2">
		<textarea
			bind:this={textarea}
			bind:value
			rows="1"
			{placeholder}
			class="h-[22px] max-h-[132px] min-h-[22px] min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-[13px] leading-[22px] text-fg outline-none placeholder:text-faint"
			{onkeydown}
			{@attach (el) => {
				if (!autofocus) return;
				// after the popover it may sit in has opened, a hidden field can't take focus
				const frame = requestAnimationFrame(() => el.focus({ preventScroll: true }));
				return () => cancelAnimationFrame(frame);
			}}></textarea>
		{#if !context}
			{@render hint()}
		{/if}
		{@render send()}
	</div>
</div>

{#snippet hint()}
	<span class="shrink-0 text-[11px] leading-[22px] whitespace-nowrap text-faint">
		{typed ? hints[1] : hints[0]}
	</span>
{/snippet}

{#snippet send()}
	<button
		type="button"
		class={[
			'grid size-[22px] shrink-0 place-items-center rounded-md bg-ink text-surface transition-opacity',
			!typed && 'pointer-events-none opacity-0'
		]}
		aria-label="Ask"
		title="Ask  ↵"
		disabled={!typed || busy}
		onclick={() => onsend(value.trim(), false)}
	>
		{#if busy}
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
{/snippet}

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
