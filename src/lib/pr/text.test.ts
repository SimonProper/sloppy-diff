import { expect, test } from 'vitest';
import { glance } from './text';

test('a comment to glance at is its text, its media named', () => {
	expect(
		glance(
			'<p>See <code>a &lt; b</code> &amp; this:</p>\n<p><img src="https://camo.githubusercontent.com/1" /></p><video src="x" controls></video>'
		)
	).toBe('See a < b & this: [image] [video]');
});
