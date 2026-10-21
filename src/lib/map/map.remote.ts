import { query } from '$app/server';
import { ask, withReader } from '$lib/server/changemap';
import { repoRoot, resolveCommit, resolveStart } from '$lib/server/git';
import { badRequestOnError } from '$lib/server/requests';
import type { ChangeMap, NodeRef, Way } from './types';

interface Range {
	repo: string;
	start: string;
	stop: string;
}

// ponytail: kept until the server restarts, a commit's map doesn't change
const maps = new Map<string, Promise<ChangeMap>>();

async function resolve({ repo, start, stop }: Range) {
	const root = await repoRoot(repo);
	const [from, to] = await Promise.all([resolveStart(root, start), resolveCommit(root, stop)]);
	return { root, from, to };
}

/** The change between two commits as a map, read by the language servers at `stop`. */
export const getChangeMap = query('unchecked', (range: Range) =>
	badRequestOnError(async () => {
		const { root, from, to } = await resolve(range);
		const key = `${root}\0${from}\0${to}`;
		let map = maps.get(key);
		if (!map) {
			map = withReader(root, from, to, (reader) => reader.map());
			maps.set(key, map);
			map.catch(() => maps.delete(key));
		}
		return map;
	})
);

/** More of the map around one node: who uses it, what it uses, or what's in it. */
export const expandChangeMap = query(
	'unchecked',
	({ way, node, ...range }: Range & { way: Way; node: NodeRef }) =>
		badRequestOnError(async () => {
			const { root, from, to } = await resolve(range);
			return withReader(root, from, to, (reader) => ask(reader, way, node));
		})
);
