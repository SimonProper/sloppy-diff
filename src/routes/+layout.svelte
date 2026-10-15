<script lang="ts">
	import '@twinkleplop/theme-github';
	import './layout.css';
	// the built-in themes, made by vite.config.ts from $lib/themes/themes.ts, and what some of
	// them add by hand. Each outweighs layout.css's own colours whatever order they come in
	import 'virtual:themes.css';
	import.meta.glob('$lib/themes/*.custom.css', { eager: true });
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
