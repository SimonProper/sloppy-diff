<script lang="ts">
	import type { FileStatus } from '$lib/diff/types';

	let { status }: { status: FileStatus } = $props();

	const letters: Record<FileStatus, string> = {
		modified: 'M',
		added: 'A',
		deleted: 'D',
		renamed: 'R',
		copied: 'C'
	};
</script>

<span
	title={status}
	class={[
		'inline-grid size-4 shrink-0 place-items-center rounded-[5px] border font-mono text-[9px] leading-none font-semibold',
		status === 'added' && 'border-add/40 bg-add/10 text-add',
		status === 'deleted' && 'border-del/40 bg-del/10 text-del',
		status === 'modified' && 'border-mod/40 bg-mod/10 text-mod',
		(status === 'renamed' || status === 'copied') && 'border-move/40 bg-move/10 text-move'
	]}
>
	{letters[status]}
</span>
