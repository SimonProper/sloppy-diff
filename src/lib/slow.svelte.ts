/**
 * True once `busy` has been true for `delay` ms, so quick loads never flash a
 * loading state and only the slow ones show one.
 */
export function slow(busy: () => boolean, delay = 250) {
	let slow = $state(false);
	$effect(() => {
		if (!busy()) {
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
