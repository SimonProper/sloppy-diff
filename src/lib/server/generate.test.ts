import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { GuideEvent } from '$lib/guide/types';
import { createFixture } from './testing/fixture';

/**
 * Guide generation against a stand-in for the claude CLI, a shell script that
 * does whatever `STUB` in its folder says.
 */
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-generate-')));
const claude = join(dir, 'claude');
const ran = join(dir, 'ran');
writeFileSync(
	claude,
	`#!/bin/sh
touch "${ran}"
case "$(cat "${dir}/STUB")" in
	exit-early) exit 3 ;;
	result)
		cat > /dev/null
		echo '{"type":"system","subtype":"init","model":"stub"}'
		echo '{"type":"result","structured_output":{"title":"T","summary":"S","sections":[]}}'
		;;
esac
`
);
chmodSync(claude, 0o755);
vi.mock('$env/dynamic/private', () => ({
	env: { ...process.env, CLAUDE_BIN: claude, GUIDES_DIR: join(dir, 'guides') }
}));

const { cancelJob, startGuide } = await import('./generate');
const { loadGuide } = await import('./guides');
const { resolveCommit } = await import('./git');

const fixture = createFixture();
afterAll(() => {
	fixture.cleanup();
	rmSync(dir, { recursive: true, force: true });
});

const stub = (mode: string) => writeFileSync(join(dir, 'STUB'), mode);
beforeEach(() => rmSync(ran, { force: true }));

/** The job's last event, once it has finished. */
function finished(job: { events: GuideEvent[]; listeners: Set<(e: GuideEvent) => void> }) {
	return new Promise<GuideEvent>((resolve) => {
		const last = job.events.at(-1);
		if (last?.type === 'done' || last?.type === 'error') return resolve(last);
		job.listeners.add((event) => {
			if (event.type === 'done' || event.type === 'error') resolve(event);
		});
	});
}

/** A fresh commit range to guide, so jobs from other tests never get joined. */
async function range(name: string, size = 10) {
	fixture.write(`${name}.txt`, 'x'.repeat(size) + '\n');
	fixture.commit(name);
	const [start, stop] = await Promise.all([
		resolveCommit(fixture.root, 'HEAD~1'),
		resolveCommit(fixture.root, 'HEAD')
	]);
	return { start, stop };
}

describe('generating a guide', () => {
	test('a result from claude is saved as the guide', async () => {
		stub('result');
		const { start, stop } = await range('saved');
		expect(await finished(startGuide(fixture.root, start, stop))).toEqual({
			type: 'done',
			start,
			stop
		});
		expect((await loadGuide(fixture.root, start, stop))?.title).toBe('T');
	});

	test('claude exiting before reading a large prompt is an error, not a crash', async () => {
		stub('exit-early');
		// well past a pipe's buffer, so writing the prompt fails with EPIPE
		const { start, stop } = await range('early', 400_000);
		const event = await finished(startGuide(fixture.root, start, stop));
		expect(event.type).toBe('error');
	});

	test('cancelling while the commits are still being read never starts claude', async () => {
		stub('result');
		const { start, stop } = await range('cancelled');
		const job = startGuide(fixture.root, start, stop);
		cancelJob(fixture.root, start, stop);
		expect(await finished(job)).toEqual({ type: 'error', message: 'Cancelled' });
		// give a wrongly started claude time to show up
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(existsSync(ran)).toBe(false);
		expect(await loadGuide(fixture.root, start, stop)).toBeNull();
	});
});
