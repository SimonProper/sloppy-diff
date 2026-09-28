import type { Layout } from '$lib/diff/split';
import type { ChangeMode } from '$lib/diff/types';
import { CHECKS, runCheck } from '$lib/server/testing/checks';
import { ABOUT, createFixture, type Result } from '$lib/server/testing/fixture';
import type { PageServerLoad } from './$types';

const MODES: ChangeMode[] = ['lines', 'tokens'];

/**
 * Builds the smoke test fixture repo, runs every change mode on it and
 * returns the rendered files next to the same checks `pnpm test` runs.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const fixture = createFixture();
	try {
		const results = {} as Record<ChangeMode, Result>;
		for (const mode of MODES) results[mode] = await fixture.run(mode);
		const checks = CHECKS.map((check) => ({
			mode: check.mode,
			file: check.file,
			label: check.label,
			...runCheck(check, results[check.mode])
		}));

		return {
			layout: (cookies.get('layout') === 'split' ? 'split' : 'unified') as Layout,
			checks,
			files: ABOUT.map(({ path, about }) => ({
				path,
				about,
				modes: MODES.map((mode) => ({ mode, file: results[mode].file(path) }))
			}))
		};
	} finally {
		fixture.cleanup();
	}
};
