<script lang="ts">
	import { tick } from 'svelte';
	import { fzf } from '$lib/fuzzy';
	import { modal } from '$lib/modal';
	import type { SessionSummary } from '$lib/agents/types';

	type Found = SessionSummary & { branch: string };

	interface Props {
		/** newest first */
		sessions: Found[];
		/** each one offered for a new session, as t3code and Intent do */
		worktrees: { path: string; branch: string }[];
		onpick: (session: Found) => void;
		onnew: (path: string) => void;
		onclose: () => void;
		/** "5m", "3h" */
		age: (at: number) => string;
	}

	let { sessions, worktrees, onpick, onnew, onclose, age }: Props = $props();

	let query = $state('');
	let picked = $state(0);
	let list = $state<HTMLElement>();

	type Entry =
		| { kind: 'session'; session: Found; title: string; branch: string }
		| { kind: 'new'; path: string; title: string; branch: string };

	/** the sessions, newest first, then a new one in each worktree */
	const entries = $derived<Entry[]>([
		...sessions.map((s) => ({
			kind: 'session' as const,
			session: s,
			title: s.title,
			branch: s.branch
		})),
		...worktrees.map((w) => ({
			kind: 'new' as const,
			path: w.path,
			title: 'New session',
			branch: w.branch
		}))
	]);

	// fzf's matching on the title and the branch as one line, so a term can match either: the
	// best first, the order they come in among equals. What matched, to mark it
	const found = $derived.by(() => {
		const match = fzf(query);
		return entries
			.map((entry, order) => {
				const hit = match(`${entry.title} ${entry.branch}`);
				if (!hit) return null;
				const after = entry.title.length + 1;
				return {
					...entry,
					score: hit.score,
					order,
					inTitle: hit.positions.filter((p) => p < entry.title.length),
					inBranch: hit.positions.filter((p) => p >= after).map((p) => p - after)
				};
			})
			.filter((m) => m !== null)
			.sort((a, b) => b.score - a.score || a.order - b.order)
			.slice(0, 50);
	});

	/** The text in runs, the matched ones marked. */
	function pieces(text: string, positions: number[]) {
		const hits = new Set(positions);
		const out: { text: string; hit: boolean }[] = [];
		for (let i = 0; i < text.length; i++) {
			const hit = hits.has(i);
			const last = out.at(-1);
			if (last?.hit === hit) last.text += text[i];
			else out.push({ text: text[i], hit });
		}
		return out;
	}

	function choose(entry: (typeof found)[number]) {
		if (entry.kind === 'session') onpick(entry.session);
		else onnew(entry.path);
	}

	function move(step: number) {
		if (!found.length) return;
		picked = (picked + step + found.length) % found.length;
		tick().then(() =>
			list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
		);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) move(1);
		else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) move(-1);
		else if (event.key === 'Enter' && found[picked]) choose(found[picked]);
		else return;
		event.preventDefault();
	}
</script>

{#snippet marked(text: string, positions: number[])}
	{#each pieces(text, positions) as piece, n (n)}{#if piece.hit}<mark
				class="bg-transparent font-semibold text-accent">{piece.text}</mark
			>{:else}{piece.text}{/if}{/each}
{/snippet}

<!-- the page's own: a native modal dialog, esc and the backdrop close it -->
<dialog
	{@attach modal}
	{onclose}
	onclick={(event) => event.target === event.currentTarget && onclose()}
	class="m-auto mt-[12vh] w-[48rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-fg shadow-float backdrop:bg-black/25"
	aria-label="Find a session"
>
	<!-- fzf's syntax, as telescope-fzf-native reads it -->
	<input
		class="h-12 w-full border-b border-line bg-transparent px-4 text-[14px] outline-none placeholder:text-muted"
		placeholder="Find a session, by its title or branch"
		title="fzf's syntax: 'exact, 'word', ^start, end$, !not, a | b"
		bind:value={query}
		oninput={() => (picked = 0)}
		{onkeydown}
		{@attach (el) => el.focus()}
		role="combobox"
		aria-expanded="true"
		aria-controls="palette-list"
		aria-activedescendant={found[picked] ? `palette-${picked}` : undefined}
	/>
	<ul
		bind:this={list}
		id="palette-list"
		role="listbox"
		aria-label="Sessions"
		class="max-h-[min(50vh,28rem)] overflow-y-auto p-1.5"
	>
		{#each found as entry, i (entry.kind === 'session' ? entry.session.id : `new ${entry.path}`)}
			<!-- picked from the field with the arrow keys, the pointer only points -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<li
				id="palette-{i}"
				role="option"
				aria-selected={i === picked}
				class={[
					'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px]',
					i === picked ? 'bg-subtle text-fg' : 'text-muted'
				]}
				onpointerenter={() => (picked = i)}
				onclick={() => choose(entry)}
			>
				{#if entry.kind === 'session'}
					{@const s = entry.session}
					<!-- in the sidebar already, or a terminal's that hasn't been opened here -->
					<span
						class={[
							'grid w-2 shrink-0 place-items-center font-mono text-[10px] leading-none',
							s.open && !s.claude ? 'text-accent' : 'text-muted'
						]}
						title={s.claude ? 'From a terminal' : s.open ? 'Open' : 'Closed'}
						>{s.claude ? '›' : s.open ? '●' : '○'}</span
					>
				{:else}
					<span class="grid w-2 shrink-0 place-items-center text-[12px] leading-none text-muted"
						>+</span
					>
				{/if}
				<span class="min-w-0 flex-1 truncate">{@render marked(entry.title, entry.inTitle)}</span>
				<span class="max-w-60 shrink-0 truncate font-mono text-[11px] text-muted"
					>{@render marked(entry.branch, entry.inBranch)}</span
				>
				<span class="w-7 shrink-0 text-right text-[11px] text-muted tabular-nums"
					>{entry.kind === 'session' ? age(entry.session.updatedAt) : ''}</span
				>
			</li>
		{:else}
			<li class="px-3 py-6 text-center text-[12.5px] text-muted">No session matches</li>
		{/each}
	</ul>
	<p class="flex gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
		<span>↑↓ to pick</span><span>↵ to open</span><span>esc to close</span>
		<span class="ml-auto" title="'exact, 'word', ^start, end$, !not, a | b">fzf syntax</span>
	</p>
</dialog>
