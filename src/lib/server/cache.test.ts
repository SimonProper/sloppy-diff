import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	cachedDiff,
	clearDiffs,
	forgetPr,
	prKey,
	prsKey,
	recentRead,
	remember,
	revalidatePr,
	storeDiff
} from './cache';

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
	it('serves the last read while reading again, not past a write to it', async () => {
		let calls = 0;
		const read = () => revalidatePr(prKey('/repo', 1), async () => ++calls, true);

		const first = read();
		expect(first.fresh).toBeNull();
		expect(await first.now).toBe(1);

		const second = read();
		expect(await second.now).toBe(1);
		expect(await second.fresh).toBe(2);
		expect(await read().now).toBe(2);

		forgetPr('/repo', 1);
		const after = read();
		expect(after.fresh).toBeNull();
		expect(await after.now).toBe(4);
	});

	it('keeps the other pull requests past a write, the list read again', async () => {
		const other = prKey('/repo', 2);
		await revalidatePr(other, async () => 'other').now;
		await revalidatePr(prsKey('/repo'), async () => 'list').now;
		forgetPr('/repo', 1);
		expect(revalidatePr(other, async () => 'next').fresh).toBeNull();
		const list = revalidatePr(prsKey('/repo'), async () => 'new list');
		expect(await list.now).toBe('list');
		expect(await list.fresh).toBe('new list');
	});

	it("doesn't keep a read that was going while a write was made", async () => {
		let finish = (_: string) => {};
		const key = prKey('/repo', 3);
		const going = revalidatePr(key, () => new Promise<string>((resolve) => (finish = resolve)));
		forgetPr('/repo', 3);
		finish('before');
		await going.now;
		expect(await revalidatePr(key, async () => 'after').now).toBe('after');
	});

	it('keeps the last read when reading again fails', async () => {
		await revalidatePr('pr-fail', async () => 'kept').now;
		await revalidatePr('pr-fail', () => Promise.reject(new Error('offline')), true).fresh?.catch(
			() => {}
		);
		expect(await revalidatePr('pr-fail', async () => 'next', true).now).toBe('kept');
	});

	it('serves a read under 10s old without asking again, unless forced', async () => {
		vi.useFakeTimers();
		try {
			let calls = 0;
			const read = (force = false) => revalidatePr('pr-recent', async () => ++calls, force);
			await read().now;
			const shared = read();
			expect(shared.fresh).toBeNull();
			expect(await shared.now).toBe(1);
			expect(await read(true).fresh).toBe(2);
			vi.advanceTimersByTime(10_001);
			expect(await read().fresh).toBe(3);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('recentRead', () => {
	it('shares a read under 10s old, the one going included, not past a write or force', async () => {
		vi.useFakeTimers();
		try {
			let calls = 0;
			const read = (force = false) => recentRead('recent-test', async () => ++calls, force);
			const [a, b] = [read(), read()];
			expect([await a, await b]).toEqual([1, 1]);
			expect(await read(true)).toBe(2);
			forgetPr('/repo', 1);
			expect(await read()).toBe(3);
			vi.advanceTimersByTime(10_001);
			expect(await read()).toBe(4);
			expect(await read()).toBe(4);
		} finally {
			vi.useRealTimers();
		}
	});

	it('forgets failures', async () => {
		await recentRead('recent-fail', () => Promise.reject(new Error('offline'))).catch(() => {});
		expect(await recentRead('recent-fail', async () => 'next')).toBe('next');
	});
});
