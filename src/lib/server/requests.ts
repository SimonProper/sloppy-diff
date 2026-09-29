import { error, isHttpError } from '@sveltejs/kit';
import { errorMessage } from './git';

/**
 * Runs `fn`, whatever goes wrong is the request's fault: a rev git doesn't
 * know, a folder that isn't a repo. It reaches the page as a 400 with git's
 * own words instead of being logged as a server error.
 */
export async function badRequestOnError<T>(fn: () => Promise<T> | T): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (isHttpError(e)) throw e;
		error(400, errorMessage(e));
	}
}
