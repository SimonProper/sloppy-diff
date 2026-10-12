import { beforeEach, describe, expect, it } from 'vitest';
import { cachedDiff, clearDiffs, forgetPrs, remember, revalidatePr, storeDiff } from './cache';

describe('diff cache', () => {
	beforeEach(clearDiffs);

	it('drops the least recently used past 40 entries', () => {
		for (let i = 0; i < 40; i++) storeDiff(`d${i}`, i, 1);
		expect(cachedDiff('d0')).toBe(0); // now most recent, d1 is oldest
		storeDiff('d40', 40, 1);
		expect(cachedDiff('d1')).toBeUndefined();
		expect(cachedDiff('d0')).toBe(0);
		expect(cachedDiff('d40')).toBe(40);
	});

	it('drops the oldest past 300k lines but always keeps the newest', () => {
		storeDiff('a', 'a', 200_000);
		storeDiff('b', 'b', 100_000);
		expect(cachedDiff('a')).toBe('a');
		storeDiff('c', 'c', 1);
		expect(cachedDiff('b')).toBeUndefined();
		storeDiff('huge', 'huge', 1_000_000);
		expect(cachedDiff('a')).toBeUndefined();
		expect(cachedDiff('huge')).toBe('huge');
	});

	it('re-storing a key replaces its weight', () => {
		storeDiff('a', 1, 299_999);
		storeDiff('a', 2, 1);
		storeDiff('b', 3, 299_999);
		expect(cachedDiff('a')).toBe(2);
	});
});

describe('remember', () => {
	it('computes once per version and forgets failures', async () => {
		let calls = 0;
		const compute = async () => ++calls;
		expect(await remember('k', 'v1', compute)).toBe(1);
		expect(await remember('k', 'v1', compute)).toBe(1);
		expect(await remember('k', 'v2', compute)).toBe(2);
		await expect(remember('f', 'v', () => Promise.reject(new Error('x')))).rejects.toThrow();
		expect(await remember('f', 'v', compute)).toBe(3);
	});
});

describe('revalidatePr', () => {
	it('serves the last read while reading again, not past a write', async () => {
		let calls = 0;
		const read = () => revalidatePr('pr-test', async () => ++calls);

		const first = read();
		expect(first.fresh).toBeNull();
		expect(await first.now).toBe(1);

		const second = read();
		expect(await second.now).toBe(1);
		expect(await second.fresh).toBe(2);
		expect(await read().now).toBe(2);

		forgetPrs();
		const after = read();
		expect(after.fresh).toBeNull();
		expect(await after.now).toBe(4);
	});

	it('keeps the last read when reading again fails', async () => {
		await revalidatePr('pr-fail', async () => 'kept').now;
		await revalidatePr('pr-fail', () => Promise.reject(new Error('offline'))).fresh?.catch(
			() => {}
		);
		expect(await revalidatePr('pr-fail', async () => 'next').now).toBe('kept');
	});
});
