import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { GuideEvent } from '$lib/guide/types';
import { createFixture } from './testing/fixture';

const directory = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-codex-generate-')));
const cli = join(directory, 'codex');
const mode = join(directory, 'mode');
const argsFile = join(directory, 'args');
const html =
	'<!doctype html><html><head><title>Change</title></head><body><canvas></canvas><script type="module">const scenes=[];</script></body></html>';
writeFileSync(
	cli,
	`#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args));
process.stdin.resume();
process.stdin.on('end', () => {
 const emit = event => process.stdout.write(JSON.stringify(event)+'\\n');
 emit({type:'thread.started',thread_id:'codex-test-session'});
 if(fs.readFileSync(${JSON.stringify(mode)},'utf8') === 'failure') {
  emit({type:'turn.failed',error:{message:'Codex test failure'}}); return;
 }
 const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));
 const draft = schema.properties.html
  ? {title:'Codex visual explainer',summary:'One illustrative scene.',html:${JSON.stringify(html)}}
  : {title:'Codex review guide',summary:'What changed.',sections:[]};
 emit({type:'item.completed',item:{id:'answer',type:'agent_message',text:JSON.stringify(draft)}});
 emit({type:'turn.completed',usage:{input_tokens:12,cached_input_tokens:4,output_tokens:8}});
});
`
);
chmodSync(cli, 0o755);
vi.mock('$env/dynamic/private', () => ({
	env: {
		...process.env,
		AI_PROVIDER: 'codex',
		CODEX_BIN: cli,
		CODEX_MODEL: 'codex-test-model',
		GUIDE_MODEL: 'claude-only-model',
		EXPLAINER_MODEL: 'claude-only-explainer',
		GUIDES_DIR: join(directory, 'saved')
	}
}));

const { startGuide, cancelJob } = await import('./generate');
const { loadGuide } = await import('./guides');
const { startExplainer, loadExplainer } = await import('./explainers');
const { resolveCommit } = await import('./git');
const fixture = createFixture();
beforeEach(() => writeFileSync(mode, 'success'));
afterAll(() => {
	fixture.cleanup();
	rmSync(directory, { recursive: true, force: true });
});

async function range(name: string) {
	fixture.write(`${name}.txt`, `${name}\n`);
	fixture.commit(name);
	return {
		start: await resolveCommit(fixture.root, 'HEAD^'),
		stop: await resolveCommit(fixture.root, 'HEAD')
	};
}

function finished(job: {
	events: GuideEvent[];
	listeners: Set<(event: GuideEvent) => void>;
}): Promise<GuideEvent> {
	return new Promise((resolve) => {
		const listener = (event: GuideEvent) => {
			if (event.type !== 'done' && event.type !== 'error') return;
			job.listeners.delete(listener);
			resolve(event);
		};
		const last = job.events.at(-1);
		if (last?.type === 'done' || last?.type === 'error') return resolve(last);
		job.listeners.add(listener);
	});
}

describe('Codex structured generation', () => {
	test('generates and saves a reconciled guide with the Codex model and provider', async () => {
		const { start, stop } = await range('guide');
		expect(await finished(startGuide(fixture.root, start, stop))).toEqual({
			type: 'done',
			start,
			stop
		});
		const saved = await loadGuide(fixture.root, start, stop);
		expect(saved).toMatchObject({
			title: 'Codex review guide',
			provider: 'codex',
			model: 'codex-test-model'
		});
		expect(saved?.sections[0]?.title).toBe('Other changes');
		const args: string[] = JSON.parse(readFileSync(argsFile, 'utf8'));
		expect(args).toContain('--output-schema');
		expect(args).not.toContain('claude-only-model');
	});

	test('generates a visual explainer and preserves it when Codex regeneration fails', async () => {
		const { start, stop } = await range('explainer');
		expect((await finished(startExplainer(fixture.root, start, stop))).type).toBe('done');
		const saved = await loadExplainer(fixture.root, start, stop);
		expect(saved).toMatchObject({
			title: 'Codex visual explainer',
			html,
			provider: 'codex',
			model: 'codex-test-model'
		});
		writeFileSync(mode, 'failure');
		expect(await finished(startExplainer(fixture.root, start, stop))).toEqual({
			type: 'error',
			message: 'Codex test failure'
		});
		expect(await loadExplainer(fixture.root, start, stop)).toEqual(saved);
	});

	test('can cancel a Codex guide before execution without persisting a result', async () => {
		const { start, stop } = await range('cancel');
		const job = startGuide(fixture.root, start, stop);
		cancelJob(fixture.root, start, stop);
		expect(await finished(job)).toEqual({ type: 'error', message: 'Cancelled' });
		expect(await loadGuide(fixture.root, start, stop)).toBeNull();
	});
});
