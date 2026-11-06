<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<!-- the band under the header the diff's views have: the page's colour, over the chat's column,
     what scrolls under it fading into it -->
<div class="sticky top-23 z-[17] h-11">
	<nav class="h-full bg-canvas px-2">
		<div class="page-column relative flex h-full items-center gap-2" style:--cap="48rem">
			{@render children()}
		</div>
	</nav>
	<div
		class="pointer-events-none absolute inset-x-0 top-full h-4 bg-linear-to-b from-canvas to-transparent"
	></div>
</div>
