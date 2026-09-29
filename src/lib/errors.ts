import { isHttpError } from '@sveltejs/kit';

/** What went wrong in a remote call, in words the page can show. */
export function errorText(e: unknown): string {
	if (isHttpError(e)) return e.body.message;
	return e instanceof Error ? e.message : String(e);
}
