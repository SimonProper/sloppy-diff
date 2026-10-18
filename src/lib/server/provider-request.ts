import { getRequestEvent } from '$app/server';
import { PROVIDER_COOKIE, providerFromCookie } from './provider';

/** Capture a request's choice before its job continues in the background. */
export function requestProvider() {
	return providerFromCookie(getRequestEvent().cookies.get(PROVIDER_COOKIE));
}
