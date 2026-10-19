<script lang="ts">
	interface Props {
		/** what's there to edit: the comment's markdown, or a send that failed */
		body: string;
		/** what went wrong last time it was saved or sent */
		failure?: string;
		/** what saving does, for its button */
		action?: string;
		/** what giving up does: leaves the comment as it was, or drops the failed send */
		cancel?: string;
		onsave: (body: string) => void;
		oncancel: () => void;
	}

	let { body, failure, action = 'Save', cancel = 'Cancel', onsave, oncancel }: Props = $props();

	// svelte-ignore state_referenced_locally
	let text = $state(body);
	const typed = $derived(text.trim().length > 0);

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			if (typed) onsave(text.trim());
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			oncancel();
		}
	}

	// as tall as the text, up to about ten lines. Runs again as it's typed
	function grow(textarea: HTMLTextAreaElement) {
		void text;
		textarea.style.height = '';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
	}
</script>

<div class="flex flex-col gap-1.5">
	<textarea
		bind:value={text}
		rows="2"
		class="min-w-0 resize-none rounded-md border border-line bg-surface px-2 py-1.5 text-[12.5px] leading-relaxed text-fg outline-none focus:border-muted"
		{onkeydown}
		{@attach grow}
		{@attach (el) => el.focus({ preventScroll: true })}></textarea>
	<div class="flex items-center gap-2 text-[11.5px]">
		{#if failure}<span class="min-w-0 flex-1 text-del">{failure}</span>{:else}<span
				class="flex-1 text-faint">⌘↵ to {action.toLowerCase()}, esc to {cancel.toLowerCase()}</span
			>{/if}
		<button type="button" class="text-muted hover:text-fg" onclick={oncancel}>{cancel}</button>
		<button
			type="button"
			class="rounded-sm bg-ink px-1.5 py-0.5 font-medium text-surface disabled:opacity-50"
			disabled={!typed}
			onclick={() => onsave(text.trim())}>{action}</button
		>
	</div>
</div>
