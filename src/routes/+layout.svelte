<script lang="ts">
	import '@twinkleplop/theme-github';
	import './layout.css';
	// each outweighs layout.css's own colours, so the order they come in doesn't matter
	import.meta.glob('$lib/themes/*.css', { eager: true });
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
