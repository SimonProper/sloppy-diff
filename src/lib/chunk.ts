/** `items` in runs of `size`, the last one shorter. */
export function chunk<T>(items: T[], size: number): T[][] {
	const runs: T[][] = [];
	for (let i = 0; i < items.length; i += size) runs.push(items.slice(i, i + size));
	return runs;
}
