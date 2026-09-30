import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
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
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// the tests build real git repos, whatever hooks, signing or prefixes the
		// developer's own git config sets must not change what they do
		env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
	}
});
