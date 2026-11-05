import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { syncOf } from './sync';
import { listen, Watchers } from './watch';

describe('Watchers', () => {
	const repo = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-watch-test-')));
	const git = (...args: string[]) =>
		execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
	git('init', '-q', '-b', 'main');
	writeFileSync(join(repo, 'a.txt'), 'one\n');
	git('add', '.');
	git('commit', '-qm', 'first');

	let told = 0;
	const stop = listen(repo, () => told++);
	const watchers = new Watchers(repo);
	afterAll(() => {
		stop();
		watchers.close();
		rmSync(repo, { recursive: true, force: true });
	});

	/** told of it within a moment */
	async function tells(change: () => void) {
		await new Promise((resolve) => setTimeout(resolve, 150));
		told = 0;
		change();
		for (let i = 0; i < 40 && !told; i++) await new Promise((resolve) => setTimeout(resolve, 25));
		return told > 0;
	}

	it('tells of an edit, staging, a commit and a new branch', async () => {
		await watchers.follow([repo]);
		if (process.platform !== 'linux') {
			expect(await tells(() => writeFileSync(join(repo, 'a.txt'), 'two\n'))).toBe(true);
		}
		expect(await tells(() => git('add', 'a.txt'))).toBe(true);
		expect(await tells(() => git('commit', '-qm', 'second'))).toBe(true);
		expect(await tells(() => git('branch', 'other'))).toBe(true);
	});

	it("doesn't tell of its own reading, which would read again for ever", async () => {
		writeFileSync(join(repo, 'a.txt'), 'three\n');
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(
			await tells(() => {
				void syncOf(repo, null);
			})
		).toBe(false);
	});

	it("doesn't tell of packages or the build", async () => {
		if (process.platform === 'linux') return;
		mkdirSync(join(repo, 'node_modules'), { recursive: true });
		expect(await tells(() => writeFileSync(join(repo, 'node_modules', 'x.js'), '1'))).toBe(false);
	});
});
