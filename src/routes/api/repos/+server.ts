import { json } from '@sveltejs/kit';
import { cachedScan } from '$lib/server/discover';
import type { RequestHandler } from './$types';

/** Git repositories found on this machine, `?refresh` scans again. */
export const GET: RequestHandler = async ({ url }) => {
	return json(await cachedScan(url.searchParams.has('refresh')));
};
