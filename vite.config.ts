import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { THEMES, themeCss } from './src/lib/themes/themes.ts';

/** The built-in themes' CSS, made from their definitions as the app is built or served. */
function themes(): Plugin {
	const id = 'virtual:themes.css';
	return {
		name: 'themes',
		resolveId: (source) => (source === id ? `\0${id}` : undefined),
		load: (resolved) => (resolved === `\0${id}` ? THEMES.map(themeCss).join('\n') : undefined)
	};
}

export default defineConfig({
	plugins: [
		themes(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// the page talks to the server through remote functions, *.remote.ts
			experimental: { remoteFunctions: true }
		})
	],
	server: {
		// the guides and the blast radius's checkouts are data, not this app's code. A checkout's
		// tsconfig.json changing would reload the page
		watch: { ignored: ['**/.guides/**'] }
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// the tests build real git repos, whatever hooks, signing or prefixes the
		// developer's own git config sets must not change what they do
		env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
	}
});
