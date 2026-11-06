<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Button from '$lib/components/Button.svelte';
	import SegmentedControl from '$lib/components/SegmentedControl.svelte';
	import WorktreeStrip from '$lib/components/WorktreeStrip.svelte';
	import { HEADER, modes, type Tab } from '$lib/tabs';
	import { linkedPr, signal } from '$lib/agents/places';
	import { getPullRequests } from '$lib/pr/pr.remote';
	import AskField from '$lib/components/ask/AskField.svelte';
	import SessionView from '$lib/components/agents/SessionView.svelte';
	import Band from '$lib/components/agents/Band.svelte';
	import SidebarLayout from '$lib/components/SidebarLayout.svelte';
	import { storedSize } from '$lib/components/ResizeHandle.svelte';
	import TerminalPanel from '$lib/components/agents/TerminalPanel.svelte';
	import { getScripts, setScripts } from '$lib/agents/terminals.remote';
	import { readJson, readText, writeJson, writeText } from '$lib/storage';
	import { drafts } from '$lib/agents/drafts.svelte';
	import { inTabOrder } from '$lib/agents/tabs.svelte';
	import { slugOf } from '$lib/agents/branch';
	import { cyclesMode, nextMode } from '$lib/agents/types';
	import AgentPickers from '$lib/components/agents/AgentPickers.svelte';
	import PillSelect from '$lib/components/PillSelect.svelte';
	import CommandPalette from '$lib/components/agents/CommandPalette.svelte';
	import {
		getAgentSettings,
		followWorktrees,
		openClaudeCodeSession,
		setAgentSettings,
		abortWorktree,
		fetchRepo,
		pullWorktree,
		rebaseWorktree,
		setSessionOpen,
		startSession
	} from '$lib/agents/agents.remote';
	import type {
		AgentSettings,
		Effort,
		Mode,
		Scripts,
		SessionSummary,
		Worktree,
		WorktreeStatus
	} from '$lib/agents/types';
	import { errorText } from '$lib/errors';
	import { repoName } from '$lib/repos';

	let { data } = $props();

	// the worktrees and their sessions as they change, told by the server rather than asked for
	const live = $derived(followWorktrees({ repo: data.repo, fetch: true }));
	// in the title strip's order, the ones without a tab after them
	const trees = $derived({
		current: live.current && inTabOrder(data.repo, live.current.worktrees),
		error: live.error
	});
	const sessionId = $derived(page.url.searchParams.get('session'));
	const cwd = $derived(page.url.searchParams.get('cwd') ?? data.here);
	/** the new session goes in a worktree of its own, from the sidebar's New worktree */
	const fresh = $derived(page.url.searchParams.has('new'));
	const tree = $derived(trees.current?.find((t) => t.path === cwd));
	const label = (t: Worktree) => t.branch ?? `detached ${t.head.slice(0, 7)}`;

	function open(params: Record<string, string>) {
		editing = null;
		goto(`?${new URLSearchParams({ repo: data.repo, ...params })}`, { keepFocus: true });
	}

	// the worktree's pull request, when it has one checked out
	const prsQuery = $derived(getPullRequests(data.repo));
	const ownPr = $derived(
		(tree && linkedPr(tree, prsQuery.error ? null : prsQuery.current)?.number) || null
	);

	/** The diff of the worktree picked here, compared the way the tab says. */
	function compare(to: Tab) {
		const params = new URLSearchParams({ repo: cwd });
		if (to === 'branch' && tree?.branch) params.set('branch', tree.branch);
		else if (to === 'range') (params.set('from', 'HEAD~1'), params.set('to', 'HEAD'));
		else if (to === 'pr' && ownPr) params.set('pr', String(ownPr));
		if (to !== 'agents') goto(`/?${params}`);
	}

	let failure = $state('');

	/** the session last followed in each worktree, to come back to from the diff */
	const LAST_KEY = 'agents-last-session';
	$effect(() => {
		if (!sessionId) return;
		writeJson(LAST_KEY, { ...readJson<Record<string, string>>(LAST_KEY, {}), [cwd]: sessionId });
	});
	let restored = false;
	$effect(() => {
		if (restored || sessionId || fresh || !trees.current) return;
		restored = true;
		const last = readJson<Record<string, string>>(LAST_KEY, {})[cwd];
		if (last && tree?.sessions.some((s) => s.id === last && s.open)) open({ cwd, session: last });
	});

	const lastFetch = $derived(live.current?.fetch);
	// what the server can't watch, an edit on Linux, is read again on coming back to the window
	$effect(() => {
		const stream = live;
		const again = () => stream.reconnect();
		addEventListener('focus', again);
		return () => removeEventListener('focus', again);
	});

	/** a session is working in it: git waits, as the server does */
	const busy = (t: WorktreeStatus) =>
		t.sessions.some((s) => s.status === 'running' || s.status === 'starting');

	/**
	 * The one thing to do about where the worktree stands, t3code's quick action: pull when it's
	 * only behind its upstream, rebase when it's behind the base. Why not, when it can't now.
	 */
	function action(
		t: WorktreeStatus
	): { kind: 'pull' | 'rebase'; label: string; why?: string } | null {
		const kind = t.behind && !t.ahead ? 'pull' : t.behindBase ? 'rebase' : null;
		if (!kind || t.conflicts) return null;
		const label = kind === 'pull' ? `Pull ${t.behind}` : `Rebase onto ${t.base}`;
		// uncommitted work is stashed and put back, as lazygit does
		const why = busy(t) ? "Wait for the agent's turn to end" : undefined;
		return { kind, label, why };
	}

	/** what the ahead and behind counts say, for their tooltip */
	function standing(t: WorktreeStatus) {
		const parts = [];
		if (t.ahead !== undefined) {
			parts.push(
				t.ahead && t.behind
					? `Diverged from its upstream: ${t.ahead} ahead, ${t.behind} behind. Rebase or merge first`
					: `${t.ahead} ahead of its upstream, ${t.behind} behind`
			);
		}
		if (t.behindBase) parts.push(`${t.behindBase} behind ${t.base}`);
		if (t.added || t.removed) parts.push(`uncommitted: +${t.added} −${t.removed}`);
		return parts.join('\n');
	}

	async function act(work: () => Promise<unknown>) {
		failure = '';
		try {
			await work();
		} catch (e) {
			failure = errorText(e);
		}
	}

	/** the worktrees a pull or rebase is running in, its button waiting meanwhile */
	let syncing = $state<Record<string, boolean>>({});
	async function sync(t: WorktreeStatus, kind: 'pull' | 'rebase') {
		syncing[t.path] = true;
		await act(() =>
			kind === 'pull'
				? pullWorktree({ repo: data.repo, cwd: t.path })
				: rebaseWorktree({ repo: data.repo, cwd: t.path })
		);
		delete syncing[t.path];
	}

	const files = (n: number, one: string, many: string) => `${n || 'its'} ${n === 1 ? one : many}`;
	/** what a box under a worktree in conflict says, by what git is stopped in */
	function conflicted(t: WorktreeStatus) {
		const n = t.conflicts?.length ?? 0;
		if (t.operation === 'rebase') return `Rebase stopped on ${files(n, 'conflict', 'conflicts')}`;
		if (t.operation) return `A ${t.operation} is stopped on ${files(n, 'conflict', 'conflicts')}`;
		if (t.stashConflict) {
			return `Your stashed changes conflict in ${files(n, 'file', 'files')}, and are kept in the stash too`;
		}
		return `${files(n, 'file is', 'files are')} in conflict`;
	}

	/** What to ask the agent for the conflicts, by what git is stopped in. */
	function resolution(t: WorktreeStatus) {
		const list = (t.conflicts ?? []).map((f) => `\`${f}\``).join(', ');
		if (t.operation === 'rebase') {
			return `The rebase of this branch onto ${t.base ?? 'the base'} stopped on conflicts in ${list}. Resolve them, keeping what both sides meant where they overlap, \`git add\` each file, then run \`GIT_EDITOR=true git rebase --continue\`, again for each commit that stops, until the rebase is done. Don't abort it.`;
		}
		if (t.operation) {
			return `A ${t.operation} in this worktree stopped on conflicts in ${list}. Resolve them, keeping what both sides meant, \`git add\` each file, then finish it with \`GIT_EDITOR=true git ${t.operation === 'merge' ? 'commit --no-edit' : `${t.operation} --continue`}\`.`;
		}
		if (t.stashConflict) {
			return `Bringing this branch up to date stashed the uncommitted changes, and putting them back conflicted in ${list}: they have conflict markers now, and the changes are also kept in the stash. Resolve the markers, keeping both the changes and what the branch now has, then \`git restore --staged\` those files so they stay uncommitted, and \`git stash drop\` once nothing in the stash is missing from the files. Don't commit.`;
		}
		return `These files are in conflict: ${list}. Find out why, resolve them keeping what both sides meant, and tell me what you did.`;
	}

	/**
	 * The conflicts for the agent: the prompt put in the worktree's newest open session's field,
	 * or a new session's, for you to read and send.
	 */
	function resolve(t: WorktreeStatus) {
		const text = resolution(t);
		const session = t.sessions.find((s) => s.open && !s.claude);
		if (session) {
			drafts[session.id] = text;
			open({ cwd: t.path, session: session.id });
		} else {
			task = text;
			newSession(t.path);
		}
	}

	/** every session in every worktree, newest first, for ⌘K */
	const everything = $derived(
		(trees.current ?? [])
			.flatMap((t) => t.sessions.map((s) => ({ ...s, branch: label(t) })))
			.sort((a, b) => b.updatedAt - a.updatedAt)
	);
	let finding = $state(false);

	/** Opens a session: in the sidebar from now on, a terminal's one made the app's. */
	async function show(s: SessionSummary) {
		finding = false;
		failure = '';
		try {
			let id = s.id;
			if (s.claude) id = await openClaudeCodeSession({ repo: data.repo, cwd: s.cwd, claude: s.id });
			else if (!s.open) await setSessionOpen({ repo: data.repo, id, open: true });
			open({ cwd: s.cwd, session: id });
		} catch (e) {
			failure = errorText(e);
		}
	}

	/** the open session to go to in a worktree: one that needs you, one done, else the newest */
	const first = (opened: SessionSummary[]) =>
		opened.find((s) => s.waiting) ?? opened.find((s) => s.unread) ?? opened[0];

	/** Takes it out of the sidebar, its Claude Code stopped. ⌘K finds it again. */
	async function close(s: SessionSummary) {
		const working = s.waiting || s.status === 'running' || s.status === 'starting';
		if (working && !confirm(`"${s.title}" is working. Close it and stop its Claude Code?`)) return;
		failure = '';
		try {
			await setSessionOpen({ repo: data.repo, id: s.id, open: false });
			if (s.id === sessionId) open({ cwd: s.cwd });
		} catch (e) {
			failure = errorText(e);
		}
	}

	/** the worktree's terminals beside the chat, open or not as last left */
	let terminal = $state(readText('agents-terminal') === 'open');
	const TERMINAL_KEY = 'agents-terminal-width';
	let panelWidth = $state(storedSize(TERMINAL_KEY));
	function toggleTerminal() {
		terminal = !terminal;
		writeText('agents-terminal', terminal ? 'open' : null);
	}

	/** ⌘K finds a session, ⌘N starts one where you are, ⌘J shows the terminals */
	function onkeydown(event: KeyboardEvent) {
		if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
		if (event.key === 'k') finding = !finding;
		else if (event.key === 'n') newSession(cwd);
		else if (event.key === 'j') toggleTerminal();
		else return;
		event.preventDefault();
	}

	/** "now", "5m", "3h", "2d" */
	function age(at: number) {
		const minutes = Math.floor((Date.now() - at) / 60_000);
		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes}m`;
		if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
		return `${Math.floor(minutes / 60 / 24)}d`;
	}

	// a new session in the picked worktree
	let task = $state('');
	let mode = $state<Mode | null>(null);
	let model = $state<string | null>(null);
	let effort = $state<Effort | null>(null);
	let starting = $state(false);
	const settings = getAgentSettings();
	/** where it starts: a worktree's path, or `new` for a worktree of its own off `base` */
	// picked here for the worktree the url names, another one picked in the sidebar wins over it
	let where = $state<{ at: string; value: string } | null>(null);
	const target = $derived(where?.at === page.url.search ? where.value : fresh ? 'new' : cwd);
	/** each new session asked for focuses the field again, the same worktree's too */
	let asked = $state(0);
	function newSession(path: string) {
		open({ cwd: path });
		asked++;
	}
	let base = $state<string | null>(null);
	const mainBranch = $derived(trees.current?.find((t) => t.main)?.branch ?? 'HEAD');
	const places = $derived([
		...(trees.current ?? []).map((t) => ({ value: t.path, label: label(t), title: t.path })),
		{
			value: 'new',
			label: 'New worktree',
			title: 'A worktree of its own, its branch named after what you ask'
		}
	]);
	const branches = $derived(
		[...new Set((trees.current ?? []).map((t) => t.branch).filter((b): b is string => !!b))].map(
			(b) => ({ value: b, label: b })
		)
	);
	async function start(text: string) {
		starting = true;
		failure = '';
		try {
			const started = await startSession({
				repo: data.repo,
				...(target === 'new' ? { base: base ?? mainBranch } : { cwd: target }),
				text,
				mode: mode ?? settings.current?.mode ?? 'auto',
				model: model ?? settings.current?.model ?? 'default',
				effort: effort ?? settings.current?.effort ?? 'default'
			});
			task = '';
			where = null;
			open({ cwd: started.cwd, session: started.id });
		} catch (e) {
			failure = errorText(e);
		} finally {
			starting = false;
		}
	}

	let editing = $state<AgentSettings | null>(null);
	const scripts = $derived(getScripts(data.repo));
	/** the repo's own, edited with the rest */
	let editingScripts = $state<Scripts>({ setup: '', run: '' });
	async function saveSettings(event: SubmitEvent) {
		event.preventDefault();
		if (!editing) return;
		try {
			await setAgentSettings(editing);
			await setScripts({ repo: data.repo, ...editingScripts });
			editing = null;
		} catch (e) {
			failure = errorText(e);
		}
	}

	/** sessions waiting on you, in the tab's title for a window in the background */
	const needed = $derived(
		(trees.current ?? []).flatMap((t) => t.sessions).filter((s) => s.open && s.waiting).length
	);
</script>

<svelte:head>
	<title>{needed ? `(${needed}) ` : ''}{repoName(data.repo)} · agents · sloppy diff</title>
</svelte:head>

<svelte:window {onkeydown} />

{#if finding}
	<CommandPalette
		sessions={everything}
		worktrees={(trees.current ?? []).map((t) => ({ path: t.path, branch: label(t) }))}
		onpick={show}
		onnew={(path) => {
			finding = false;
			newSession(path);
		}}
		onclose={() => (finding = false)}
		{age}
	/>
{/if}

<div class="min-h-screen font-sans">
	<header class="sticky top-0 z-20 bg-canvas">
		<WorktreeStrip main={data.repo} place={{ kind: 'tree', path: cwd }} fetch />
		<div class="flex h-11 items-center gap-1.5 px-3 min-[1351px]:gap-2 min-[1351px]:px-4">
			<div class="shrink-0">
				<SegmentedControl
					options={modes(ownPr)}
					value="agents"
					onchange={compare}
					label="Agents and comparisons"
				/>
			</div>
			<span class="flex-1"></span>
			<Button
				size="lg"
				pressed={terminal}
				title="The worktree's terminals  ⌘J"
				onclick={toggleTerminal}>Terminal</Button
			>
			<Button
				size="lg"
				pressed={!!editing}
				onclick={() => {
					editingScripts = { setup: '', run: '', ...scripts.current };
					editing = editing
						? null
						: {
								...(settings.current ?? {
									wrapper: '',
									sandbox: true,
									mode: 'auto',
									model: 'default',
									effort: 'default',
									autoPull: false
								})
							};
				}}>Settings</Button
			>
		</div>
	</header>

	<!-- the repo's worktrees and the sessions in each, the sidebar's card as the diff's files are -->
	{#snippet worktrees()}
		<div class="min-h-0 flex-1 overflow-y-auto p-2">
			{#if trees.error && !trees.current}
				<p class="px-2 py-3 text-[12px] text-del">
					Couldn't list the worktrees: {errorText(trees.error)}
				</p>
			{:else if !trees.current}
				<p class="px-2 py-3 text-[12px] text-muted">Reading the worktrees…</p>
			{/if}
			{#each trees.current ?? [] as t (t.path)}
				{@const opened = t.sessions.filter((s) => s.open)}
				{@const counts = !!(t.ahead || t.behind || t.behindBase || t.added || t.removed)}
				<div class="group/tree mb-1.5">
					<!-- herdr's line for a worktree, in two: its branch with the line to itself, then how
					     far it is from upstream and what's uncommitted. Its actions take room on hover -->
					<div
						class={[
							'flex gap-1 rounded-lg py-1 pr-1 pl-2 hover:bg-subtle',
							t.path === cwd && !sessionId && !editing && 'bg-subtle'
						]}
					>
						<button
							type="button"
							class="flex min-w-0 flex-1 flex-col text-left"
							title={[t.path, standing(t)].filter(Boolean).join('\n')}
							onclick={() => (opened.length ? show(first(opened)) : newSession(t.path))}
						>
							<span
								class={[
									'truncate font-mono text-[12.5px] leading-5',
									t.main ? 'text-fg' : 'text-muted'
								]}>{label(t)}</span
							>
							{#if counts}
								<!-- counts, not good or bad: muted, the amber one says it needs a rebase -->
								<span
									class="flex min-w-0 items-center gap-1.5 font-mono text-[11px] leading-4 text-muted"
								>
									{#if t.ahead}<span>↑{t.ahead}</span>{/if}
									{#if t.behind}<span>↓{t.behind}</span>{/if}
									{#if t.behindBase}<span
											class="truncate text-mod"
											title="{t.behindBase} behind {t.base}"
											>↓{t.behindBase} {t.base?.replace(/^[^/]+\//, '')}</span
										>{/if}
									{#if t.added || t.removed}
										<span class="tabular-nums">+{t.added} −{t.removed}</span>
									{/if}
								</span>
							{/if}
						</button>
						<div class="flex shrink-0 flex-col items-end">
							<button
								type="button"
								class="hidden size-5 place-items-center rounded-full text-muted group-focus-within/tree:grid group-hover/tree:grid hover:bg-canvas hover:text-fg"
								title="New session in {label(t)}  ⌘N"
								aria-label="New session in {label(t)}"
								onclick={() => newSession(t.path)}
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
							{#if action(t)}
								{@const next = action(t)!}
								<!-- under the +, by the counts that call for it -->
								<button
									type="button"
									class={[
										'h-4 items-center gap-1 rounded-full px-1.5 text-[10.5px] leading-none text-muted ring-1 ring-line hover:text-fg disabled:opacity-50 disabled:hover:text-muted',
										syncing[t.path]
											? 'flex'
											: 'hidden group-focus-within/tree:flex group-hover/tree:flex'
									]}
									title={next.why ??
										(next.kind === 'pull'
											? `Fast-forwards to its upstream${t.dirty ? ', its uncommitted changes stashed and put back' : ''}`
											: `git rebase ${t.base}${t.dirty ? ', its uncommitted changes stashed and put back' : ''}, conflicts are left for the agent`)}
									disabled={!!next.why || syncing[t.path]}
									onclick={() => sync(t, next.kind)}
									>{#if syncing[t.path]}<span
											class="size-2 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
										></span>{/if}{next.kind === 'pull' ? 'Pull' : 'Rebase'}</button
								>
							{/if}
						</div>
					</div>
					{#if t.conflicts}
						<!-- Vibe Kanban's: a rebase stopped, for the agent to resolve or to give up on -->
						<div
							class="mx-2 mb-1 rounded-lg border border-mod/40 bg-mod/8 px-2 py-1.5 text-[11.5px]"
						>
							<p class="text-fg" title={t.conflicts.join('\n')}>{conflicted(t)}</p>
							<div class="mt-1 flex gap-1.5">
								<Button
									size="xs"
									variant="solid"
									title={busy(t)
										? "Wait for the agent's turn to end"
										: 'Puts what to ask in its field, for you to read and send'}
									disabled={busy(t)}
									onclick={() => resolve(t)}>Ask the agent</Button
								>
								{#if t.operation}
									<Button
										size="xs"
										disabled={busy(t)}
										title={busy(t)
											? "Wait for the agent's turn to end"
											: `git ${t.operation} --abort, back to before it`}
										onclick={() => act(() => abortWorktree({ repo: data.repo, cwd: t.path }))}
										>Abort</Button
									>
								{/if}
							</div>
						</div>
					{/if}
					{#each opened as s (s.id)}
						{@const st = signal(s)}
						<div
							class={[
								'group/session flex h-7 items-center gap-2 rounded-md pr-1 pl-4 hover:bg-subtle',
								s.id === sessionId && 'bg-subtle'
							]}
						>
							<button
								type="button"
								class={[
									'flex min-w-0 flex-1 items-center gap-2 text-left text-[12px]',
									s.id === sessionId || s.waiting || s.unread ? 'text-fg' : 'text-muted'
								]}
								title={`${s.title}\n${st.title}`}
								onclick={() => show(s)}
							>
								{#if st.glyph === 'check'}
									<svg
										viewBox="0 0 16 16"
										class={['size-3 shrink-0', st.class]}
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg
									>
								{:else}
									<span class="grid size-3 shrink-0 place-items-center"
										><span class={['size-1.5 rounded-full', st.class]}></span></span
									>
								{/if}
								<span class="sr-only">{st.title}:</span>
								<span class="min-w-0 flex-1 truncate">{s.title}</span>
								<span
									class="shrink-0 text-[10.5px] text-muted tabular-nums group-focus-within/session:hidden group-hover/session:hidden"
									>{age(s.updatedAt)}</span
								>
							</button>
							<button
								type="button"
								class="hidden size-5 shrink-0 place-items-center rounded-full text-muted group-focus-within/session:grid group-hover/session:grid hover:bg-canvas hover:text-fg"
								title="Close, ⌘K finds it again"
								aria-label="Close {s.title}"
								onclick={() => close(s)}
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
				</div>
			{/each}
		</div>
		<div class="flex flex-col gap-1 border-t border-line p-2">
			<Button size="sm" class="w-full" onclick={() => open({ cwd, new: '' })}>New worktree</Button>
			<!-- the counts are as fresh as this, it fetches every minute while the page is open -->
			<button
				type="button"
				class="flex h-7 items-center justify-between gap-2 rounded-md px-2 text-[11.5px] text-muted hover:bg-subtle hover:text-fg"
				title={lastFetch?.error ? `The last fetch failed: ${lastFetch.error}` : 'Fetch now'}
				disabled={lastFetch?.fetching}
				onclick={() => act(() => fetchRepo(data.repo))}
			>
				<span class="flex items-center gap-1.5">
					{#if lastFetch?.error}<span class="size-1.5 rounded-full bg-del"></span>{/if}
					{lastFetch?.fetching
						? 'Fetching…'
						: lastFetch?.at
							? `Fetched ${age(lastFetch.at)} ago`
							: 'Not fetched yet'}
				</span>
				<svg
					viewBox="0 0 16 16"
					class={['size-3', lastFetch?.fetching && 'animate-spin']}
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" /></svg
				>
			</button>
			<button
				type="button"
				class="flex h-7 items-center justify-between rounded-md px-2 text-[11.5px] text-muted hover:bg-subtle hover:text-fg"
				onclick={() => (finding = true)}
				>Find a session <kbd class="font-sans text-faint">⌘K</kbd></button
			>
		</div>
	{/snippet}

	<!-- folded, the sidebar still says who needs you: a dot for each open session -->
	{#snippet rail()}
		<!-- only the worktrees with sessions open, a line between them and none above the first -->
		{#each (trees.current ?? []).filter((t) => t.sessions.some((s) => s.open)) as t, n (t.path)}
			{@const opened = t.sessions.filter((s) => s.open)}
			{#if opened.length}
				{#if n > 0}<span class="h-px w-5 shrink-0 bg-line"></span>{/if}
				{#each opened as s (s.id)}
					{@const st = signal(s)}
					<button
						type="button"
						class={[
							'grid size-7 shrink-0 place-items-center rounded-full',
							// the one on screen as the open sidebar marks it, no outline
							s.id === sessionId ? 'bg-subtle' : 'hover:bg-subtle'
						]}
						aria-label="{s.title}, {label(t)}: {st.title}"
						data-tip="{s.title} · {label(t)} · {st.title}"
						onclick={() => show(s)}
					>
						{#if st.glyph === 'check'}
							<svg
								viewBox="0 0 16 16"
								class={['size-3', st.class]}
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg
							>
						{:else}
							<span class={['size-2 rounded-full', st.class]}></span>
						{/if}
					</button>
				{/each}
			{/if}
		{/each}
	{/snippet}

	{#snippet terminals()}
		<TerminalPanel repo={data.repo} {cwd} onclose={toggleTerminal} />
	{/snippet}

	{#if failure}
		<!-- an action's error where it's seen, the actions are in the sidebar and the palette -->
		<div
			class="fixed top-[144px] left-1/2 z-30 flex max-w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border border-del/40 bg-surface px-3 py-2 text-[12.5px] shadow-float"
			role="alert"
		>
			<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-del"></span>
			<p class="min-w-0 break-words">{failure}</p>
			<button
				type="button"
				class="shrink-0 text-muted hover:text-fg"
				aria-label="Dismiss"
				onclick={() => (failure = '')}>×</button
			>
		</div>
	{/if}

	<SidebarLayout
		layout="unified"
		chars={70}
		stickyTop={HEADER}
		panelTop={HEADER}
		aside={worktrees}
		{rail}
		sizeKey="agents-sidebar-width"
		defaultWidth={300}
		panel={terminal ? terminals : undefined}
		onpanelclose={toggleTerminal}
		panelKey={TERMINAL_KEY}
		bind:panelWidth
	>
		{#if editing}
			<Band><span class="text-[13px] font-medium">Agent settings</span></Band>
			<form
				class="page-column flex flex-col gap-4 px-3 pt-4 pb-24 text-[12.5px]"
				style:--cap="36rem"
				onsubmit={saveSettings}
			>
				<label class="flex flex-col gap-1.5">
					<span class="font-medium">Run Claude Code inside</span>
					<input
						class="h-9 rounded-md border border-line bg-surface px-2.5 font-mono text-[12px]"
						placeholder="nono run --allow {'{worktree}'} --allow {'{repo}'} --"
						bind:value={editing.wrapper}
					/>
					<span class="text-muted"
						>A command put before <code>claude</code>, like a sandbox. <code>{'{worktree}'}</code>
						is the session's worktree, <code>{'{repo}'}</code> the main checkout, whose
						<code>.git</code> a worktree's git needs. Empty runs <code>claude</code> as it is.</span
					>
				</label>
				<label class="flex items-start gap-2">
					<input type="checkbox" class="mt-0.5" bind:checked={editing.sandbox} />
					<span>
						<span class="font-medium">Claude Code's own sandbox</span>
						<span class="block text-muted"
							>Its commands run in Seatbelt on macOS, bubblewrap on Linux. Turn it off when the
							command above is a sandbox already, one can't always run inside another.</span
						>
					</span>
				</label>
				<label class="flex items-start gap-2">
					<input type="checkbox" class="mt-0.5" bind:checked={editing.autoPull} />
					<span>
						<span class="font-medium">Pull the main checkout after each fetch</span>
						<span class="block text-muted"
							>Only fast-forwarding, and only when it's on the default branch, has nothing
							uncommitted or of its own, and no agent is working in it.</span
						>
					</span>
				</label>
				<label class="flex flex-col gap-1.5">
					<span class="font-medium">Set up a new worktree with</span>
					<input
						class="h-9 rounded-md border border-line bg-surface px-2.5 font-mono text-[12px]"
						placeholder="pnpm install"
						bind:value={editingScripts.setup}
					/>
					<span class="text-muted"
						>This repo's. Typed into a Setup terminal in each worktree the app makes, while the
						agent starts. <code>$SLOPPY_ROOT</code> is the main checkout, to copy an
						<code>.env</code> from.</span
					>
				</label>
				<label class="flex flex-col gap-1.5">
					<span class="font-medium">Run with</span>
					<input
						class="h-9 rounded-md border border-line bg-surface px-2.5 font-mono text-[12px]"
						placeholder="pnpm dev"
						bind:value={editingScripts.run}
					/>
					<span class="text-muted"
						>This repo's. The terminal panel's Run button types it into a terminal of its own, Stop
						closes it.</span
					>
				</label>
				<div class="flex flex-col items-start gap-1.5">
					<span class="font-medium">New sessions start in</span>
					<div class="flex items-center gap-1.5">
						<AgentPickers
							repo={data.repo}
							mode={editing.mode}
							model={editing.model}
							onmode={(m) => editing && (editing.mode = m)}
							effort={editing.effort}
							onmodel={(m) => editing && (editing.model = m)}
							oneffort={(e) => editing && (editing.effort = e)}
						/>
					</div>
				</div>
				<p class="text-muted">
					Running sessions pick up changes after their current turn. New sessions start with these;
					mode, model and effort can then be changed in each.
				</p>
				<div class="flex gap-2">
					<Button variant="solid" size="md" type="submit">Save</Button>
					<Button size="md" onclick={() => (editing = null)}>Cancel</Button>
				</div>
			</form>
		{:else if sessionId}
			{#key sessionId}
				<SessionView
					repo={data.repo}
					id={sessionId}
					branch={tree ? label(tree) : cwd}
					review={`/?${new URLSearchParams(
						tree?.aheadBase && tree.branch ? { repo: cwd, branch: tree.branch } : { repo: cwd }
					)}`}
					onfork={(id) => open({ cwd, session: id })}
				/>
			{/key}
		{:else}
			<Band>
				<span class="text-[13px] font-medium">New session</span>
			</Band>
			<div
				class="page-column flex min-h-[calc(100dvh-192px)] flex-col justify-center gap-3 px-3 pb-24"
				style:--cap="42rem"
			>
				<p class="text-[15px] font-medium">What should the agent do?</p>
				<!-- where it works: a worktree there is, or one of its own as t3code and Intent make them -->
				<div class="flex items-center gap-1.5 text-[12px] text-muted">
					In
					<PillSelect
						label="Where the agent works"
						options={places}
						value={target}
						onchange={(v) => (where = { at: page.url.search, value: v })}
					/>
					{#if target === 'new'}
						off
						<PillSelect
							label="The branch the worktree starts from"
							options={branches.length ? branches : [{ value: mainBranch, label: mainBranch }]}
							value={base ?? mainBranch}
							onchange={(v) => (base = v)}
						/>
						{#if task.trim()}
							<span class="min-w-0 truncate"
								>as <span class="font-mono text-fg">{slugOf(task)}</span></span
							>
						{/if}
					{/if}
				</div>
				<!-- a card floating over the page, as the diff's question composer is. ⇧⇥ in its text
				     cycles the mode, as in Claude Code -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="rounded-2xl border border-line bg-surface p-1.5 shadow-float"
					onkeydown={(event) => {
						if (!cyclesMode(event)) return;
						event.preventDefault();
						mode = nextMode(mode ?? settings.current?.mode ?? 'auto');
					}}
				>
					{#key asked}
						<AskField
							bare
							bind:value={task}
							placeholder={target === 'new'
								? 'Describe the change, its branch is named after it'
								: 'Describe the change'}
							hints={['', '⌘↵ to start']}
							action="Start"
							busy={starting}
							autofocus
							onsend={start}
						/>
					{/key}
					<!-- how the agent works, under the field it is told what to do in -->
					<div class="mt-1 flex items-center justify-between gap-1.5 px-1.5 pb-0.5">
						<AgentPickers
							repo={data.repo}
							shortcut
							mode={mode ?? settings.current?.mode ?? 'auto'}
							model={model ?? settings.current?.model ?? 'default'}
							onmode={(m) => (mode = m)}
							effort={effort ?? settings.current?.effort ?? 'default'}
							onmodel={(m) => (model = m)}
							oneffort={(e) => (effort = e)}
						/>
					</div>
				</div>
				{#if starting}
					<p class="flex items-center gap-2 px-1 text-[12px] text-muted" aria-live="polite">
						<span
							class="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
						></span>
						{target === 'new'
							? `Fetching, creating the worktree ${slugOf(task)} and starting Claude Code…`
							: 'Starting Claude Code…'}
					</p>
				{/if}
			</div>
		{/if}
	</SidebarLayout>
</div>
