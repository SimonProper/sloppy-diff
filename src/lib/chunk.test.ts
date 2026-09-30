import { expect, test } from 'vitest';
import { chunk } from './chunk';

test('chunk splits into runs of the given size, the last one shorter', () => {
	expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
	expect(chunk([], 3)).toEqual([]);
});
