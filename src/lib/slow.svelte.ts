import { navigating } from '$app/state';

/**
 * True once a navigation has been running for `delay` ms, so quick page loads
 * never flash a loading bar and only the slow ones show one.
 */
export function slowNavigation(delay = 250) {
	let slow = $state(false);
	$effect(() => {
		if (!navigating.to) {
			slow = false;
			return;
		}
		const timer = setTimeout(() => (slow = true), delay);
		return () => clearTimeout(timer);
	});
	return {
		get current() {
			return slow;
		}
	};
}
