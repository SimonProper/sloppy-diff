<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import XTerm from './XTerm.svelte';
	import {
		closeTerminalIn,
		getScripts,
		getTerminals,
		newTerminal
	} from '$lib/agents/terminals.remote';
	import { errorText } from '$lib/errors';

	/** the worktree's terminals, Conductor's and t3code's panel beside the chat */
	let { repo, cwd, onclose }: { repo: string; cwd: string; onclose: () => void } = $props();

	const list = $derived(getTerminals({ repo, cwd }));
	const terminals = $derived(list.current ?? []);
	const scripts = $derived(getScripts(repo));
	let picked = $state<string | null>(null);
	const active = $derived(terminals.find((t) => t.id === picked) ?? terminals.at(-1));
	const running = $derived(terminals.find((t) => t.title === 'Run' && t.exited === undefined));
	let failure = $state('');

	async function act(work: () => Promise<unknown>) {
		failure = '';
		try {
			await work();
		} catch (e) {
			failure = errorText(e);
		}
	}

	const open = (run = false) =>
		act(async () => (picked = (await newTerminal({ repo, cwd, run })).id));

	async function close(id: string) {
		const last = terminals.length === 1;
		await act(() => closeTerminalIn({ repo, cwd, id }));
		// as VS Code's panel does, closing its last terminal hides it
		if (last) onclose();
	}

	// opened on a worktree with none, a shell to type in
	let opened = '';
	$effect(() => {
		if (list.current && !list.current.length && opened !== cwd) {
			opened = cwd;
			open();
		}
	});
</script>

<div class="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-2 pl-2 shadow-strip">
	<div class="flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto">
		{#each terminals as t (t.id)}
			<div
				class={[
					'group/tab flex h-7 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 text-[12px]',
					t.id === active?.id ? 'bg-subtle text-fg' : 'text-muted hover:text-fg'
				]}
			>
				<button
					type="button"
					class="flex items-center gap-1.5"
					title={t.exited === undefined ? undefined : `Exited with ${t.exited}`}
					onclick={() => (picked = t.id)}
				>
					{#if t.exited !== undefined}<span class="size-1.5 rounded-full bg-faint/60"></span>{/if}
					{t.title}
				</button>
				<button
					type="button"
					class="grid size-5 place-items-center rounded text-faint opacity-0 group-hover/tab:opacity-100 hover:text-fg focus-visible:opacity-100"
					aria-label="Close {t.title}"
					title="Close, stopping what it runs"
					onclick={() => close(t.id)}
				>
					<svg
						viewBox="0 0 16 16"
						class="size-3"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg
					>
				</button>
			</div>
		{/each}
		<button
			type="button"
			class="grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-subtle hover:text-fg"
			aria-label="New terminal"
			title="New terminal"
			onclick={() => open()}
		>
			<svg
				viewBox="0 0 16 16"
				class="size-3.5"
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9" /></svg
			>
		</button>
	</div>
	{#if running}
		<Button size="sm" title="Closes the Run terminal" onclick={() => close(running.id)}>Stop</Button
		>
	{:else}
		<Button
			size="sm"
			disabled={!scripts.current?.run}
			title={scripts.current?.run || 'Set a run script in Settings'}
			onclick={() => open(true)}>Run</Button
		>
	{/if}
</div>
{#if failure}
	<p class="px-3 pt-2 text-[12px] text-del">{failure}</p>
{/if}
<div class="min-h-0 flex-1 py-1.5 pl-2">
	{#if active}
		{#key active.id}
			<XTerm id={active.id} onexit={() => list.refresh()} />
		{/key}
	{/if}
</div>
