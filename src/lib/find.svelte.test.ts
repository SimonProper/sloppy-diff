import { describe, expect, it } from 'vitest';
import { occurrences } from './find.svelte';

describe('occurrences', () => {
	it('ignores case unless the query has capitals', () => {
		expect(occurrences('Foo foo FOO', 'foo')).toEqual([0, 4, 8]);
		expect(occurrences('Foo foo FOO', 'Foo')).toEqual([0]);
	});

	it("doesn't count overlapping matches twice, nor an empty query", () => {
		expect(occurrences('aaaa', 'aa')).toEqual([0, 2]);
		expect(occurrences('abc', '')).toEqual([]);
	});
});
