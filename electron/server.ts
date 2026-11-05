// The app's server, in an Electron utility process of its own rather than the main process.
// The main process is the one input reaches the page through, and the server's work on it, git
// spawned for every status read, held keystrokes up for a few hundred milliseconds at a time.
// Started by main.ts, which waits for the url it says it's listening on.
// TypeScript that Electron's Node runs as it is, its types stripped, so only types Node can
// erase: no enums, namespaces or parameter properties.
import { createServer } from 'node:http';
import { join } from 'node:path';

const dev = process.argv.includes('--dev');

/** Starts the server and returns where it's listening. */
async function serve(): Promise<string> {
	if (dev) {
		const { createServer } = await import('vite');
		const vite = await createServer({ root: join(import.meta.dirname, '..') });
		await vite.listen();
		return vite.resolvedUrls!.local[0].replace(/\/$/, '');
	}
	// set by main.ts: adapter-node assumes https without it, and every POST would fail the
	// origin checks
	const origin = process.env.ORIGIN!;
	const { port, hostname } = new URL(origin);
	// the build's output, there only after `vite build`, its path a variable so `pnpm check`
	// doesn't type-check the bundle
	const built = '../build/handler.js';
	const { handler } = await import(built);
	await new Promise<void>((resolve) =>
		createServer(handler).listen(Number(port), hostname, () => resolve())
	);
	return origin;
}

// the main process, which forked this one
const parent = (process as unknown as { parentPort: { postMessage(message: unknown): void } })
	.parentPort;

serve().then(
	(url) => parent.postMessage({ url }),
	(error) => parent.postMessage({ error: String(error?.stack ?? error) })
);
