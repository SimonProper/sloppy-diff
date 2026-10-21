/**
 * One line to the dev server's terminal, so what runs behind a spinner (an
 * agent, a language server, git) can be followed. Quiet under the tests.
 */
export function log(scope: string, message: string) {
	if (process.env.VITEST) return;
	// a gh graphql query or a prompt would bury the rest
	const line = message.length > 300 ? `${message.slice(0, 300)}…` : message;
	console.log(`${new Date().toTimeString().slice(0, 8)} [${scope}] ${line}`);
}

const ms = (since: number) => `${Math.round(performance.now() - since)}ms`;

/** Logs `what` once `work` settles, with how long it took and whether it failed. */
export async function logged<T>(scope: string, what: string, work: Promise<T>): Promise<T> {
	const since = performance.now();
	try {
		const result = await work;
		log(scope, `${what} (${ms(since)})`);
		return result;
	} catch (error) {
		const reason = String((error as Error)?.message ?? error).split('\n')[0];
		log(scope, `${what} failed (${ms(since)}): ${reason}`);
		throw error;
	}
}
