// One loop drives every orb in this context (the worker, or the main thread as fallback).

import { createOrbState, draw, drawStatic, step, type Ctx2D, type OrbState } from './rainOrbCore';

export interface OrbOptions {
	size: number; // CSS px
	dpr: number; // already capped at 2 by the caller
	fps: number; // 30 recommended, 60 allowed
	color: string; // any CSS color string, read on the main thread
	reduced: boolean; // prefers-reduced-motion
	active: boolean; // false when offscreen, tab hidden or paused
}

interface Orb {
	ctx: Ctx2D;
	state: OrbState;
	opts: OrbOptions;
	t: number; // local clock, only advances while active
}

type Raf = (cb: (now: number) => void) => unknown;

export function createEngine(raf: Raf) {
	const orbs = new Map<string, Orb>();
	let scheduled = false;
	let last = 0;

	const animating = (o: Orb) => o.opts.active && !o.opts.reduced;

	function render(o: Orb) {
		if (o.opts.reduced) drawStatic(o.ctx, o.state, o.opts.color);
		else draw(o.ctx, o.state, o.t, o.opts.color);
	}

	function frame(now: number) {
		scheduled = false;
		let fps = 0;
		for (const o of orbs.values()) if (animating(o)) fps = Math.max(fps, o.opts.fps);
		if (!fps) {
			last = 0;
			return; // nothing to animate, let the loop die
		}
		if (!last) last = now;
		const elapsed = now - last;
		if (elapsed >= 1000 / fps - 2) {
			const dt = Math.min(elapsed / 1000, 0.1); // clamp so a long hitch doesn't skip ripples
			last = now;
			for (const o of orbs.values()) {
				if (!animating(o)) continue;
				o.t += dt;
				step(o.state, o.t);
				render(o);
			}
		}
		ensureLoop();
	}

	function ensureLoop() {
		if (scheduled) return;
		for (const o of orbs.values()) {
			if (animating(o)) {
				scheduled = true;
				raf(frame);
				return;
			}
		}
		last = 0;
	}

	return {
		add(id: string, canvas: HTMLCanvasElement | OffscreenCanvas, opts: OrbOptions) {
			const ctx = canvas.getContext('2d') as Ctx2D | null;
			if (!ctx) return;
			ctx.setTransform(opts.dpr, 0, 0, opts.dpr, 0, 0);
			const orb: Orb = { ctx, state: createOrbState(opts.size), opts, t: 0 };
			orbs.set(id, orb);
			step(orb.state, 0);
			render(orb);
			ensureLoop();
		},
		update(id: string, patch: Partial<OrbOptions>) {
			const o = orbs.get(id);
			if (!o) return;
			o.opts = { ...o.opts, ...patch };
			if (patch.color !== undefined || patch.reduced !== undefined) render(o);
			ensureLoop();
		},
		remove(id: string) {
			orbs.delete(id);
		}
	};
}

export type Engine = ReturnType<typeof createEngine>;
