/**
 * Tells elements when they come near the viewport and when they're far from
 * it again, for rendering only what can be seen. Two distances so an element
 * right at the edge doesn't flip back and forth while scrolling.
 */
type Callback = (near: boolean) => void;

const callbacks = new Map<Element, Callback>();
/** how many screens from the viewport counts as near */
const NEAR = 1.5;
let enter: IntersectionObserver | undefined;
let leave: IntersectionObserver | undefined;

function observers() {
	// within a screen and a half of the viewport comes in, ahead of a fast scroll
	enter ??= new IntersectionObserver(
		(entries) => {
			for (const e of entries) if (e.isIntersecting) callbacks.get(e.target)?.(true);
		},
		{ rootMargin: `${NEAR * 100}% 0px` }
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
	// the observers only tell after a frame is painted, one just put on the page near the
	// screen would show blank for that frame: the layout switching, a file coming back. They're
	// checked at once instead, together, so the page is laid out for all of them once
	if (!fresh.length) queueMicrotask(checkFresh);
	fresh.push(el);
	return () => {
		callbacks.delete(el);
		for (const observer of observers()) observer.unobserve(el);
	};
}

let fresh: Element[] = [];

function checkFresh() {
	const batch = fresh;
	fresh = [];
	const margin = innerHeight * NEAR;
	// read all, then call back, which renders: reading between renders lays the page out each time
	const near = batch.map((el) => {
		if (!el.isConnected) return false;
		const { top, bottom } = el.getBoundingClientRect();
		return bottom > -margin && top < innerHeight + margin;
	});
	batch.forEach((el, i) => near[i] && callbacks.get(el)?.(true));
}
