// Rain orb: pure simulation + drawing. No DOM access, safe to run in a worker.

export type Vec3 = [number, number, number];
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Two tuned presets. Sizes in between are scaled from the nearest one. */
export const PRESETS = {
	large: { refSize: 64, dots: 200, dotRadius: 1.25 }, // avatar / standalone
	small: { refSize: 20, dots: 60, dotRadius: 0.8 } // inline next to text
} as const;

/** All visual tuning lives here. Times in seconds, angles in radians. */
export const PARAMS = {
	sphereRadius: 0.4, // fraction of the canvas size
	spawnEvery: 0.9, // minimum gap between drops, calmer than the spec's 0.5
	spawnJitter: 0.6, // extra random gap, 0..spawnJitter: a drop every 0.9 to 1.5s
	minDropSpacing: 0.9, // min angle between consecutive drop points
	minFacing: 0.15, // drops land on the visible side (z >= this)
	life: 2.2, // how long one ripple lives
	waveSpeed: 1.4, // ripple front speed over the sphere surface
	waveOffset: 0.1, // ripple starts slightly "before" the drop point
	frontSigma: 0.12, // sharp leading edge
	tailSigma: 0.3, // soft trailing edge
	baseAlpha: 0.12, // resting dots are faint, the sphere still there between drops
	depthAlphaMin: 0.4, // far-side dots are dimmer...
	depthSizeMin: 0.55, // ...and smaller
	swell: 0.5, // dot radius grows by this fraction at the wave peak
	lift: 0.06 // dots push outward from the surface at the wave peak
} as const;

export interface Drop {
	v: Vec3;
	t0: number;
}

export interface OrbState {
	size: number;
	radius: number; // sphere radius in CSS px
	dotRadius: number; // base dot radius in CSS px
	points: Vec3[]; // unit sphere, sorted back to front
	drops: Drop[];
	nextSpawn: number;
}

export function fibonacciSphere(n: number): Vec3[] {
	const ga = Math.PI * (3 - Math.sqrt(5));
	const pts: Vec3[] = [];
	for (let i = 0; i < n; i++) {
		const y = 1 - (2 * (i + 0.5)) / n;
		const r = Math.sqrt(1 - y * y);
		const th = i * ga;
		pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
	}
	return pts.sort((a, b) => a[2] - b[2]); // paint far side first
}

export function createOrbState(size: number): OrbState {
	const preset = size <= 32 ? PRESETS.small : PRESETS.large;
	const scale = size / preset.refSize;
	return {
		size,
		radius: size * PARAMS.sphereRadius,
		dotRadius: preset.dotRadius * scale,
		points: fibonacciSphere(preset.dots),
		drops: [],
		nextSpawn: 0
	};
}

const asym = (d: number, front: number, tail: number) => {
	const s = d > 0 ? front : tail;
	return Math.exp(-(d * d) / (2 * s * s));
};

function randomDropPoint(prev?: Vec3): Vec3 {
	const minDot = Math.cos(PARAMS.minDropSpacing);
	let v: Vec3 = [0, 0, 1];
	for (let tries = 0; tries < 30; tries++) {
		const x = Math.random() * 2 - 1;
		const y = Math.random() * 2 - 1;
		const z = Math.random() * 2 - 1;
		const l = Math.hypot(x, y, z) || 1;
		v = [x / l, y / l, z / l];
		if (v[2] < PARAMS.minFacing) continue;
		if (prev && v[0] * prev[0] + v[1] * prev[1] + v[2] * prev[2] > minDot) continue;
		break;
	}
	return v;
}

/** Advance the simulation to local time t: spawn new drops, drop expired ones. */
export function step(state: OrbState, t: number): void {
	if (t >= state.nextSpawn) {
		const prev = state.drops[state.drops.length - 1]?.v;
		state.drops.push({ v: randomDropPoint(prev), t0: t });
		state.nextSpawn = t + PARAMS.spawnEvery + Math.random() * PARAMS.spawnJitter;
	}
	state.drops = state.drops.filter((d) => t - d.t0 < PARAMS.life);
}

export function draw(ctx: Ctx2D, state: OrbState, t: number, color: string): void {
	const { size, radius: R, dotRadius, points, drops } = state;
	const c = size / 2;
	const P = PARAMS;
	ctx.clearRect(0, 0, size, size);
	ctx.fillStyle = color;

	for (const p of points) {
		let I = 0;
		for (const d of drops) {
			const age = t - d.t0;
			if (age < 0 || age >= P.life) continue;
			const cos = Math.max(-1, Math.min(1, p[0] * d.v[0] + p[1] * d.v[1] + p[2] * d.v[2]));
			const front = age * P.waveSpeed - P.waveOffset;
			I += asym(Math.acos(cos) - front, P.frontSigma, P.tailSigma) * (1 - age / P.life);
		}
		if (I > 1) I = 1;

		const f = (p[2] + 1) / 2; // 0 = far side, 1 = facing viewer
		const alpha =
			(P.baseAlpha + (1 - P.baseAlpha) * I) * (P.depthAlphaMin + (1 - P.depthAlphaMin) * f);
		if (alpha < 0.015) continue;
		const s = 1 + P.lift * I;
		const r = dotRadius * (P.depthSizeMin + (1 - P.depthSizeMin) * f) * (1 + P.swell * I);

		ctx.globalAlpha = alpha > 1 ? 1 : alpha;
		ctx.beginPath();
		ctx.arc(c + p[0] * s * R, c + p[1] * s * R, r, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.globalAlpha = 1;
}

/** Representative still frame for prefers-reduced-motion. */
export function drawStatic(ctx: Ctx2D, state: OrbState, color: string): void {
	const norm = (v: Vec3): Vec3 => {
		const l = Math.hypot(v[0], v[1], v[2]);
		return [v[0] / l, v[1] / l, v[2] / l];
	};
	const T = 10;
	const frozen: OrbState = {
		...state,
		drops: [
			{ v: norm([-0.35, -0.45, 0.82]), t0: T - 0.55 },
			{ v: norm([0.5, 0.2, 0.84]), t0: T - 1.1 },
			{ v: norm([-0.1, 0.6, 0.79]), t0: T - 0.25 }
		]
	};
	draw(ctx, frozen, T, color);
}
