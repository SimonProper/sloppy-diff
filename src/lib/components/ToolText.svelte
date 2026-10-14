<script lang="ts">
	import FileIcon from './FileIcon.svelte';

	/** A tool call as the progress shows it. A path is cut from its start so the file name shows. */
	let { text }: { text: string } = $props();

	const read = $derived(/^(Reading) (.+)$/.exec(text));
</script>

{#if read}
	<span class="flex min-w-0 items-center gap-1.5">
		<span class="shrink-0">{read[1]}</span>
		<span
			class="flex min-w-0 items-center gap-1 rounded-[5px] border border-line bg-surface py-px pr-1.5 pl-1"
			title={read[2]}
		>
			<FileIcon path={read[2]} />
			<!-- rtl puts the ellipsis on the left, bdi keeps the path's own order -->
			<span class="truncate text-left [direction:rtl]"><bdi>{read[2]}</bdi></span>
		</span>
	</span>
{:else}
	<span class="min-w-0 truncate" title={text}>{text}</span>
{/if}
