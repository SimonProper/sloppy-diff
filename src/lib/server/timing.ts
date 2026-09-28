/**
 * Collects how long each step of a request takes, reported as a Server-Timing
 * header so the breakdown shows up in the browser's network panel.
 */
export class Timing {
	private entries: [string, number][] = [];
	private readonly started = performance.now();

	async measure<T>(name: string, work: Promise<T> | (() => Promise<T>)): Promise<T> {
		const start = performance.now();
		try {
			return await (typeof work === 'function' ? work() : work);
		} finally {
			this.entries.push([name, performance.now() - start]);
		}
	}

	header(): string {
		return (
			[...this.entries, ['total', performance.now() - this.started] as [string, number]]
				// header values only allow plain tokens, anything else would fail the whole response
				.map(([name, ms]) => `${name.replace(/[^\w-]/g, '_')};dur=${ms.toFixed(1)}`)
				.join(', ')
		);
	}
}
