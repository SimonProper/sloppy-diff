/**
 * Which of a list of elements is being read: the last one whose top has
 * scrolled up to `line`, just under the sticky bars, the first until one
 * has. For the sidebar to show where the page is.
 */

/**
 * The index being read from each element's top relative to the viewport,
 * NaN for elements that aren't there, -1 when none is. At the end of the page
 * the last elements can't scroll up to the line, so `end` has the viewport's
 * height and the index jumped to, which wins while it's on screen.
 */
export function currentIndex(
	tops: number[],
	line: number,
	end?: { height: number; target: number }
): number {
	let index = -1;
	tops.forEach((top, i) => {
		if (top <= line) index = i;
	});
	if (index < 0) index = tops.findIndex((top) => !Number.isNaN(top));
	if (!end || index < 0) return index;
	return end.target > index && tops[end.target] < end.height ? end.target : index;
}

/** The id of the element being read, following the window's scroll. */
export function scrollSpy(ids: () => string[], line = 120) {
	let current = $state<string | null>(null);

	$effect(() => {
		const list = ids();
		let frame = 0;
		const update = () => {
			frame = 0;
			const tops = list.map(
				(id) => document.getElementById(id)?.getBoundingClientRect().top ?? NaN
			);
			const root = document.documentElement;
			const atEnd = scrollY + innerHeight >= root.scrollHeight - 2;
			const target = list.indexOf(decodeURIComponent(location.hash.slice(1)));
			current =
				list[currentIndex(tops, line, atEnd ? { height: innerHeight, target } : undefined)] ?? null;
		};
		const schedule = () => {
			frame ||= requestAnimationFrame(update);
		};
		update();
		addEventListener('scroll', schedule, { passive: true });
		addEventListener('resize', schedule);
		addEventListener('hashchange', schedule);
		// diffs opening, folding and rendering move everything below them without a scroll
		const resize = new ResizeObserver(schedule);
		resize.observe(document.body);
		return () => {
			cancelAnimationFrame(frame);
			removeEventListener('scroll', schedule);
			removeEventListener('resize', schedule);
			removeEventListener('hashchange', schedule);
			resize.disconnect();
		};
	});

	return {
		get current() {
			return current;
		}
	};
}

/**
 * Scrolls the list `el` sits in just enough to show it, `top` clear of rows
 * stuck over the top of the list. Only that list moves, the page keeps its
 * scroll, a smooth one included.
 */
export function reveal(el: HTMLElement, top = 0) {
	let box = el.parentElement;
	while (
		box &&
		!(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))
	) {
		box = box.parentElement;
	}
	if (!box) return;
	const row = el.getBoundingClientRect();
	const view = box.getBoundingClientRect();
	if (row.top < view.top + top) box.scrollTop += row.top - view.top - top;
	else if (row.bottom > view.bottom) box.scrollTop += row.bottom - view.bottom;
}
