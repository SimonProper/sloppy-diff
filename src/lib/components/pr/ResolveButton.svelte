<script lang="ts">
	import { page } from '$app/state';
	import { errorText } from '$lib/errors';
	import { setResolved } from '$lib/pr/pr.remote';
	import { refresh } from '$lib/pr/refresh';
	import type { ReviewThread } from '$lib/pr/types';

	let { thread }: { thread: ReviewThread } = $props();

	let busy = $state(false);
	let failure = $state('');

	async function toggle() {
		busy = true;
		failure = '';
		try {
			await setResolved({
				repo: page.data.repo,
				number: Number(page.data.inputs.pr),
				thread: thread.id,
				resolved: !thread.isResolved
			});
			await refresh();
		} catch (e) {
			failure = errorText(e);
		} finally {
			busy = false;
		}
	}
</script>

{#if thread.canResolve}
	<button
		type="button"
		class={[
			'shrink-0 rounded-full px-1.5 text-[11px] hover:bg-subtle hover:text-fg disabled:opacity-50',
			failure ? 'text-del' : 'text-muted'
		]}
		title={failure || undefined}
		disabled={busy}
		onclick={toggle}
		>{busy
			? thread.isResolved
				? 'Unresolving…'
				: 'Resolving…'
			: thread.isResolved
				? 'Unresolve'
				: 'Resolve'}</button
	>
{/if}
