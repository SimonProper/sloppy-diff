<script lang="ts">
	import { page } from '$app/state';
	import { errorText } from '$lib/errors';
	import { removeComment } from '$lib/pr/pr.remote';
	import { refresh } from '$lib/pr/refresh';
	import type { PrComment } from '$lib/pr/types';

	let { comment }: { comment: PrComment } = $props();

	let deleting = $state(false);
	let failure = $state('');

	async function remove() {
		const kind = comment.deletable;
		if (!kind) return;
		// a posted comment may have been read already, a draft only you have seen
		if (!comment.pending && !confirm("Delete this comment? This can't be undone.")) return;
		deleting = true;
		failure = '';
		try {
			await removeComment({ repo: page.data.repo, id: comment.id, kind });
			await refresh();
		} catch (e) {
			failure = errorText(e);
		} finally {
			deleting = false;
		}
	}
</script>

<!-- on the comment's hover, like the way to a thread -->
<span class="ml-auto flex shrink-0 items-center gap-2">
	{#if failure}
		<span class="text-del" title={failure}>Couldn't delete</span>
	{/if}
	<button
		type="button"
		class={[
			'hover:text-del focus-visible:opacity-100',
			!deleting && !failure && 'opacity-0 group-hover/comment:opacity-100'
		]}
		disabled={deleting}
		onclick={remove}>{deleting ? 'Deleting…' : 'Delete'}</button
	>
</span>
