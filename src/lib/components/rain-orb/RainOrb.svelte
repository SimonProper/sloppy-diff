<script lang="ts" module>
	import { createEngine, type Engine, type OrbOptions } from './rainOrbEngine';

	// One shared worker for every orb on the page, made on first use. The orb shows exactly
	// when the page is busy with an agent's stream, so it's drawn off the main thread

	let worker: Worker | null = null;
	let workerFailed = false;
	let mainEngine: Engine | null = null;
	let seq = 0;

	function getWorker(): Worker | null {
		if (worker || workerFailed) return worker;
		try {
			worker = new Worker(new URL('./rainOrb.worker.ts', import.meta.url), { type: 'module' });
		} catch {
			workerFailed = true;
		}
		return worker;
	}

	interface Handle {
		update(patch: Partial<OrbOptions>): void;
		remove(): void;
	}

	function attach(canvas: HTMLCanvasElement, opts: OrbOptions): Handle {
		const id = `rain-orb-${++seq}`;
		const w = 'transferControlToOffscreen' in canvas ? getWorker() : null;
		if (w) {
			const off = canvas.transferControlToOffscreen();
			w.postMessage({ type: 'add', id, canvas: off, opts }, [off]);
			return {
				update: (patch) => w.postMessage({ type: 'update', id, patch }),
				remove: () => w.postMessage({ type: 'remove', id })
			};
		}
		// fallback: the same engine, on the main thread
		mainEngine ??= createEngine((cb) => requestAnimationFrame(cb));
		const e = mainEngine;
		e.add(id, canvas, opts);
		return { update: (patch) => e.update(id, patch), remove: () => e.remove(id) };
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';

	/**
	 * The rain orb: a sphere of dots that raindrops ripple across, a monochrome working
	 * indicator, in the colour of its text. Animated in a shared worker, paused while it's off
	 * screen or the tab is hidden, a still frame where motion is reduced.
	 */
	interface Props {
		/** CSS px. 20 and 64 are the tuned sizes; others scale from the nearest. */
		size?: number;
		/** freeze on the current frame */
		paused?: boolean;
		/** 30 by default; the motion is soft enough that 60 rarely looks different */
		fps?: 30 | 60;
		/** what it's busy with, its accessible name */
		label?: string;
		class?: string;
	}

	let {
		size = 64,
		paused = false,
		fps = 30,
		label = 'Working',
		class: className
	}: Props = $props();

	/** tells the orb whether it should move, kept by the attachment */
	let sync = () => {};
	$effect(() => {
		void paused;
		sync();
	});

	// The canvas is made here rather than in the markup: transferControlToOffscreen() can only be
	// called once on an element, and the attachment runs again for a new size or rate
	function orb(host: HTMLElement) {
		const canvas = document.createElement('canvas');
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		canvas.width = Math.round(size * dpr);
		canvas.height = Math.round(size * dpr);
		canvas.style.width = `${size}px`;
		canvas.style.height = `${size}px`;
		canvas.style.display = 'block';
		canvas.setAttribute('aria-hidden', 'true');
		host.appendChild(canvas);

		const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
		const darkMq = matchMedia('(prefers-color-scheme: dark)');
		let onScreen = true;
		let color = getComputedStyle(host).color;
		// paused is told through sync: read here it would make a new canvas each time it changes
		const isActive = () =>
			onScreen && document.visibilityState === 'visible' && !untrack(() => paused);

		const handle = attach(canvas, {
			size,
			dpr,
			fps,
			color,
			reduced: reducedMq.matches,
			active: isActive()
		});

		const syncActive = () => handle.update({ active: isActive() });
		sync = syncActive;

		// the worker can't read CSS: the colour is read here and sent on a theme change
		const syncColor = () => {
			const next = getComputedStyle(host).color;
			if (next !== color) {
				color = next;
				handle.update({ color });
			}
		};
		const syncReduced = () => handle.update({ reduced: reducedMq.matches });

		const io = new IntersectionObserver(([entry]) => {
			onScreen = entry.isIntersecting;
			syncActive();
		});
		io.observe(host);

		// theme changes: the OS's, or a class, data-theme or style change on <html> or <body>
		const mo = new MutationObserver(syncColor);
		const attrs = { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] };
		mo.observe(document.documentElement, attrs);
		mo.observe(document.body, attrs);

		document.addEventListener('visibilitychange', syncActive);
		darkMq.addEventListener('change', syncColor);
		reducedMq.addEventListener('change', syncReduced);

		return () => {
			io.disconnect();
			mo.disconnect();
			document.removeEventListener('visibilitychange', syncActive);
			darkMq.removeEventListener('change', syncColor);
			reducedMq.removeEventListener('change', syncReduced);
			sync = () => {};
			handle.remove();
			canvas.remove();
		};
	}
</script>

<span
	role="img"
	aria-label={label}
	class={['inline-block shrink-0', className]}
	style:width="{size}px"
	style:height="{size}px"
	{@attach orb}
></span>
