import type { Handle, HandleServerError } from '@sveltejs/kit';

/**
 * Any website the user visits can send requests to localhost, and SvelteKit's
 * own origin check is off in dev. Browsers say where a request comes from, so
 * everything that isn't the app itself is refused. Opening the app in a tab
 * from a link elsewhere still works.
 */
export const handle: Handle = ({ event, resolve }) => {
	const headers = event.request.headers;
	const site = headers.get('sec-fetch-site');
	const origin = headers.get('origin');
	const navigation = headers.get('sec-fetch-mode') === 'navigate' && event.request.method === 'GET';
	const foreignSite = site !== null && site !== 'same-origin' && site !== 'none' && !navigation;
	const foreignOrigin = origin !== null && origin !== event.url.origin;
	if (foreignSite || foreignOrigin) {
		return new Response('Requests from other sites are refused', { status: 403 });
	}
	return resolve(event);
};

// a local tool: show the real error instead of a generic "Internal Error"
export const handleError: HandleServerError = ({ error }) => {
	console.error(error);
	return { message: error instanceof Error ? error.message : String(error) };
};
