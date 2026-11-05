// Dedicated worker: owns every transferred OffscreenCanvas and animates them off the main thread.

import { createEngine, type OrbOptions } from './rainOrbEngine';

type Msg =
	| { type: 'add'; id: string; canvas: OffscreenCanvas; opts: OrbOptions }
	| { type: 'update'; id: string; patch: Partial<OrbOptions> }
	| { type: 'remove'; id: string };

const scope = self as unknown as {
	requestAnimationFrame?: (cb: (now: number) => void) => number;
	onmessage: ((e: MessageEvent<Msg>) => void) | null;
};

// rAF is available in workers in current Chromium, Firefox and Safari; fall back to a timer otherwise.
const raf =
	typeof scope.requestAnimationFrame === 'function'
		? scope.requestAnimationFrame.bind(scope)
		: (cb: (now: number) => void) => setTimeout(() => cb(performance.now()), 16);

const engine = createEngine(raf);

scope.onmessage = (e) => {
	const m = e.data;
	if (m.type === 'add') engine.add(m.id, m.canvas, m.opts);
	else if (m.type === 'update') engine.update(m.id, m.patch);
	else if (m.type === 'remove') engine.remove(m.id);
};
