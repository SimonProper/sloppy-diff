/**
 * Tells elements when they come near the viewport and when they're far from
 * it again, for rendering only what can be seen. Two distances so an element
 * right at the edge doesn't flip back and forth while scrolling.
 */
type Callback = (near: boolean) => void;

const callbacks = new Map<Element, Callback>();
let enter: IntersectionObserver | undefined;
let leave: IntersectionObserver | undefined;

function observers() {
	// within a screen of the viewport comes in
	enter ??= new IntersectionObserver(
		(entries) => {
			for (const e of entries) if (e.isIntersecting) callbacks.get(e.target)?.(true);
		},
		{ rootMargin: '100% 0px' }
	);
	// more than three screens away goes out
	leave ??= new IntersectionObserver(
		(entries) => {
			for (const e of entries) if (!e.isIntersecting) callbacks.get(e.target)?.(false);
		},
		{ rootMargin: '300% 0px' }
	);
	return [enter, leave];
}

/** Calls back as `el` comes near the viewport or goes far from it, returns the cleanup. */
export function watch(el: Element, callback: Callback): () => void {
	callbacks.set(el, callback);
	for (const observer of observers()) observer.observe(el);
	return () => {
		callbacks.delete(el);
		for (const observer of observers()) observer.unobserve(el);
	};
}

/** `items` in runs of `size`, the last one shorter. */
export function chunk<T>(items: T[], size: number): T[][] {
	const runs: T[][] = [];
	for (let i = 0; i < items.length; i += size) runs.push(items.slice(i, i + size));
	return runs;
}
