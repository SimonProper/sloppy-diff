<script lang="ts">
	let { src, class: size = 'size-4' }: { src: string; class?: string } = $props();
</script>

<!-- beside the name, so it says nothing to a screen reader. A deleted account has none,
     a blank circle keeps the names lined up. The ring keeps a dark picture off a dark page -->
{#if src}
	<img
		{src}
		alt=""
		loading="lazy"
		class={[size, 'shrink-0 rounded-full bg-subtle ring-1 ring-line']}
	/>
{:else}
	<span class={[size, 'shrink-0 rounded-full bg-subtle ring-1 ring-line']}></span>
{/if}
