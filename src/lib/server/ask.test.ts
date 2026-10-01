import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AskEvent, Scope, Thread } from '$lib/ask/types';
import { parseDiff } from '$lib/diff/parse';
import { createFixture } from './testing/fixture';

/**
 * Asking about lines of a diff, against a stand-in for the claude CLI that
 * does whatever `STUB` in its folder says and writes down how it was run.
 */
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-ask-')));
const claude = join(dir, 'claude');
const runs = join(dir, 'runs');

// what a real session streams: init, a thought, a file read, then the answer. The
// session's running cost comes from COST
const answer = (session: string) =>
	[
		{ type: 'system', subtype: 'init', model: 'stub', session_id: session },
		{
			type: 'stream_event',
			event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Hmm, ' } }
		},
		{ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'Hmm, a rename.' }] } },
		{ type: 'assistant', message: { content: [{ type: 'text', text: 'Let me look.' }] } },
		{
			type: 'assistant',
			message: {
				content: [{ type: 'tool_use', name: 'Read', input: { file_path: `${dir}/x.ts` } }]
			}
		},
		{
			type: 'stream_event',
			event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'It is ' } }
		},
		{
			type: 'assistant',
			message: {
				content: [{ type: 'text', text: 'It is **fine**.' }],
				usage: { input_tokens: 3, cache_read_input_tokens: 1000, output_tokens: 20 }
			}
		}
	]
		.map((m) => `echo '${JSON.stringify(m)}'`)
		.concat(
			`printf '${JSON.stringify({
				type: 'result',
				subtype: 'success',
				result: 'It is **fine**.',
				session_id: session,
				total_cost_usd: 0,
				usage: { output_tokens_details: { thinking_tokens: 42 } }
			}).replace('"total_cost_usd":0', '"total_cost_usd":%s')}\\n' "$(cat "${dir}/COST")"`
		)
		.join('\n');

writeFileSync(
	claude,
	`#!/bin/sh
n=$(ls "${runs}" 2>/dev/null | wc -l | tr -d ' ')
run="${runs}/$n"
mkdir -p "$run"
printf '%s\\n' "$@" > "$run/args"
pwd > "$run/cwd"
cat ./*.diff > "$run/diff" 2>/dev/null
cat > "$run/prompt"
args="$*"
answer() {
${answer('sess-1')}
}
case "$(cat "${dir}/STUB")" in
	answer) answer ;;
	slow) sleep 0.5; answer ;;
	gone)
		case "$args" in
			*--resume*) echo '{"type":"result","subtype":"error","is_error":true,"result":"No conversation found"}'; exit 1 ;;
		esac
		answer ;;
	old)
		case "$args" in
			*--thinking-display*) echo "error: unknown option '--thinking-display'" >&2; exit 1 ;;
		esac
		answer ;;
	hang) sleep 5 ;;
esac
`
);
chmodSync(claude, 0o755);
vi.mock('$env/dynamic/private', () => ({
	env: { ...process.env, CLAUDE_BIN: claude, GUIDES_DIR: join(dir, 'guides') }
}));

const { ask, cancelAsk, cut, getAskJob, sourceFor } = await import('./ask');
const { deleteThread, loadThreads, prepareThreads } = await import('./threads');
const { readDiff, resolveCommit } = await import('./git');

const fixture = createFixture();
afterAll(() => {
	fixture.cleanup();
	rmSync(dir, { recursive: true, force: true });
});

const stub = (mode: string, cost = '0.03') => {
	writeFileSync(join(dir, 'STUB'), mode);
	writeFileSync(join(dir, 'COST'), cost);
};
beforeEach(() => {
	rmSync(runs, { recursive: true, force: true });
	rmSync(join(dir, 'guides'), { recursive: true, force: true });
});

/** How claude was run the nth time in this test. */
const run = (n: number) => ({
	args: readFileSync(join(runs, String(n), 'args'), 'utf8')
		.trim()
		.split('\n'),
	cwd: readFileSync(join(runs, String(n), 'cwd'), 'utf8').trim(),
	/** the whole change's diff, as it was in claude's folder while it ran */
	diff: readFileSync(join(runs, String(n), 'diff'), 'utf8'),
	prompt: readFileSync(join(runs, String(n), 'prompt'), 'utf8')
});

const [from, to] = await Promise.all([
	resolveCommit(fixture.root, 'main'),
	resolveCommit(fixture.root, 'change')
]);
const files = parseDiff(await readDiff(fixture.root, from, to));
const cart = files.find((f) => f.newPath === 'src/cart.ts')!;
const hunk = cart.hunks[0];
const added = hunk.lines.findIndex((l) => l.kind === 'add');
const span = { hunk: hunk.id, start: added, end: added };

/** The job's last event, once it has finished. */
function finished(thread: Thread, scope: Scope = `${from}..${to}`) {
	const job = getAskJob(fixture.root, scope, thread.id)!;
	return new Promise<AskEvent>((resolve) => {
		const last = job.events.at(-1);
		if (last?.type === 'done' || last?.type === 'error') return resolve(last);
		job.listeners.add((event: AskEvent) => {
			if (event.type === 'done' || event.type === 'error') resolve(event);
		});
	});
}

describe('asking about lines', () => {
	test('the answer is saved with its thinking, tool calls and cost', async () => {
		stub('answer');
		const source = await sourceFor(fixture.root, from, to);
		const thread = await ask(source, { text: 'Why the rename?', span });
		expect(thread.anchor).toMatchObject({ path: 'src/cart.ts', hunk: hunk.id });
		expect(thread.messages.map((m) => m.role)).toEqual(['user']);

		const event = await finished(thread);
		expect(event.type).toBe('done');
		const [saved] = await loadThreads(fixture.root, source.scope);
		const reply = saved.messages[1];
		expect(reply).toMatchObject({
			role: 'assistant',
			text: 'It is **fine**.',
			thinkingTokens: 42,
			cost: 0.03,
			model: 'stub'
		});
		expect(reply.steps).toEqual([
			{ type: 'thinking', text: 'Hmm, a rename.' },
			{ type: 'text', text: 'Let me look.' },
			{ type: 'tool', text: expect.stringMatching(/^Reading .*x\.ts$/) }
		]);
		expect(saved.sessionId).toBe('sess-1');
		expect(saved.sessionTokens).toBe(1023);
		if (event.type === 'done') expect(event.thread.messages[1].html).toContain('<strong>');

		const first = run(0);
		expect(first.prompt).toContain('Why the rename?');
		expect(first.prompt).toContain(thread.anchor.code);
		expect(first.args).toEqual(
			expect.arrayContaining(['--thinking-display', '--strict-mcp-config'])
		);
		expect(first.args[first.args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob');
		expect(first.args[first.args.indexOf('--add-dir') + 1]).toBe(fixture.root);
		// sessions stay out of the reviewed repo's own session list
		expect(first.cwd).not.toBe(fixture.root);
		expect(first.cwd.endsWith('/sessions')).toBe(true);
		// the whole change was there to read while it answered, and is gone once it's in
		expect(first.diff).toContain('src/cart.ts');
		expect(first.prompt).toContain(`${first.cwd}/${thread.id}.diff`);
		await vi.waitFor(() => expect(existsSync(`${first.cwd}/${thread.id}.diff`)).toBe(false));

		await deleteThread(fixture.root, source.scope, thread.id);
	});

	test('a follow-up resumes the session and only costs its own turn', async () => {
		stub('answer');
		const source = await sourceFor(fixture.root, from, to);
		const thread = await ask(source, { text: 'First?', span });
		await finished(thread);

		stub('answer', '0.05');
		await ask(source, { text: 'And then?', thread: thread.id });
		await finished(thread);

		const second = run(1);
		expect(second.args[second.args.indexOf('--resume') + 1]).toBe('sess-1');
		expect(second.prompt.trim()).toBe('And then?');
		const [saved] = await loadThreads(fixture.root, source.scope);
		expect(saved.messages.map((m) => m.cost)).toEqual([undefined, 0.03, undefined, 0.02]);

		await deleteThread(fixture.root, source.scope, thread.id);
	});

	test('a session that is gone starts a new one with the conversation so far', async () => {
		stub('answer');
		const source = await sourceFor(fixture.root, from, to);
		const thread = await ask(source, { text: 'First?', span });
		await finished(thread);

		stub('gone');
		await ask(source, { text: 'Still there?', thread: thread.id });
		expect((await finished(thread)).type).toBe('done');
		const retry = run(2);
		expect(retry.args).not.toContain('--resume');
		expect(retry.prompt).toContain('Earlier in this conversation');
		expect(retry.prompt).toContain('It is **fine**.');

		await deleteThread(fixture.root, source.scope, thread.id);
	});

	test('a claude without summarised thinking answers without it', async () => {
		stub('old');
		const source = await sourceFor(fixture.root, from, to);
		const thread = await ask(source, { text: 'Old?', span });
		expect((await finished(thread)).type).toBe('done');
		expect(run(1).args).not.toContain('--thinking-display');

		await deleteThread(fixture.root, source.scope, thread.id);
	});

	test('cancelling keeps the question and says the answer was cancelled', async () => {
		stub('hang');
		const source = await sourceFor(fixture.root, from, to);
		const thread = await ask(source, { text: 'Slow?', span });
		cancelAsk(fixture.root, source.scope, thread.id);
		expect(await finished(thread)).toEqual({ type: 'error', message: 'Cancelled' });
		// the cancelled answer is written after the event
		await vi.waitFor(async () => {
			const [saved] = await loadThreads(fixture.root, source.scope);
			expect(saved.messages.map((m) => m.error)).toEqual([undefined, 'Cancelled']);
		});

		await deleteThread(fixture.root, source.scope, thread.id);
	});

	test('asking again replaces the failed answer instead of repeating the question', async () => {
		stub('hang');
		const source = await sourceFor(fixture.root, from, to);
		const thread = await ask(source, { text: 'Again?', span });
		cancelAsk(fixture.root, source.scope, thread.id);
		await finished(thread);
		await vi.waitFor(async () => {
			const [saved] = await loadThreads(fixture.root, source.scope);
			expect(saved.messages).toHaveLength(2);
		});

		stub('answer');
		await ask(source, { text: '', thread: thread.id, retry: true });
		expect((await finished(thread)).type).toBe('done');
		const [saved] = await loadThreads(fixture.root, source.scope);
		expect(saved.messages.map((m) => [m.role, m.text, m.error])).toEqual([
			['user', 'Again?', undefined],
			['assistant', 'It is **fine**.', undefined]
		]);
	});

	test('a thread deleted while Claude answers stays deleted', async () => {
		stub('slow');
		const source = await sourceFor(fixture.root, from, to);
		const thread = await ask(source, { text: 'Gone?', span });
		await deleteThread(fixture.root, source.scope, thread.id);
		expect(await finished(thread)).toEqual({
			type: 'error',
			message: 'The thread was deleted while Claude answered'
		});
		expect(await loadThreads(fixture.root, source.scope)).toEqual([]);
	});

	test('only lines that are in the diff can be asked about', async () => {
		stub('answer');
		const source = await sourceFor(fixture.root, from, to);
		await expect(
			ask(source, { text: 'Where?', span: { ...span, hunk: 'hnothing' } })
		).rejects.toThrow('not in the diff');
		await expect(
			ask(source, { text: 'Where?', span: { ...span, end: hunk.lines.length } })
		).rejects.toThrow('Select some lines');
		// the removed lines alone, on the new side, are nothing
		const removed = hunk.lines.findIndex((l) => l.kind === 'del');
		await expect(
			ask(source, {
				text: 'Where?',
				span: { hunk: hunk.id, start: removed, end: removed, side: 'new' }
			})
		).rejects.toThrow('Select some lines');
		expect(await loadThreads(fixture.root, source.scope)).toEqual([]);
	});

	test('uncommitted changes have threads of their own', async () => {
		stub('answer');
		fixture.write(
			'src/cart.ts',
			readFileSync(join(fixture.root, 'src/cart.ts'), 'utf8') + '// more\n'
		);
		const source = await sourceFor(fixture.root, 'HEAD', '');
		expect(source.scope).toBe('worktree');
		const diff = parseDiff(await readDiff(fixture.root, 'HEAD', ''));
		const h = diff[0].hunks[0];
		const line = h.lines.findIndex((l) => l.kind === 'add');
		const thread = await ask(source, {
			text: 'New?',
			span: { hunk: h.id, start: line, end: line }
		});
		expect(thread.anchor.code).toBe('+// more');
		await finished(thread, 'worktree');

		// once the lines change, the thread is outdated rather than gone
		const saved = await loadThreads(fixture.root, 'worktree');
		fixture.write(
			'src/cart.ts',
			readFileSync(join(fixture.root, 'src/cart.ts'), 'utf8') + '// again\n'
		);
		const now = parseDiff(await readDiff(fixture.root, 'HEAD', ''));
		expect(prepareThreads(saved, now).map((t) => t.outdated)).toEqual([true]);
		expect(prepareThreads(saved, diff).map((t) => t.outdated)).toEqual([false]);
	});
});

describe('asking about a whole file or the whole change', () => {
	test('a file question gets the whole file diff and no selection', async () => {
		stub('answer');
		const source = await sourceFor(fixture.root, from, to);
		const thread = await ask(source, { text: 'What changed here?', path: 'src/cart.ts' });
		expect(thread.anchor).toEqual({ path: 'src/cart.ts', label: 'whole file', code: '' });
		await finished(thread);

		const { prompt } = run(0);
		expect(prompt).toContain('a question about the whole of src/cart.ts');
		expect(prompt).toContain('The diff of src/cart.ts');
		expect(prompt).not.toContain('<selection>');
		// outdated once the file is out of the diff
		const [saved] = await loadThreads(fixture.root, source.scope);
		expect(prepareThreads([saved], files)[0].outdated).toBe(false);
		expect(prepareThreads([saved], [])[0].outdated).toBe(true);

		await deleteThread(fixture.root, source.scope, thread.id);
	});

	test('a question about the whole change lists the files, and is never outdated', async () => {
		stub('answer');
		const source = await sourceFor(fixture.root, from, to);
		const thread = await ask(source, { text: 'Ready to merge?' });
		expect(thread.anchor).toEqual({ path: '', label: 'whole change', code: '' });
		await finished(thread);

		const { prompt } = run(0);
		expect(prompt).toContain('a question about the change as a whole');
		expect(prompt).toMatch(/<files>\n[^]*src\/cart\.ts \+\d+ −\d+/);
		const [saved] = await loadThreads(fixture.root, source.scope);
		expect(prepareThreads([saved], [])[0].outdated).toBe(false);

		await deleteThread(fixture.root, source.scope, thread.id);
	});

	test('a file that is not in the diff is refused', async () => {
		const source = await sourceFor(fixture.root, from, to);
		await expect(ask(source, { text: 'Hm?', path: 'nope.ts' })).rejects.toThrow(/not in the diff/);
	});
});

test('cut keeps whole lines within the limit and says what it left out', () => {
	expect(cut('one\ntwo\nthree', 100, 'x')).toBe('one\ntwo\nthree');
	expect(cut('one\ntwo\nthree', 9, 'the rest is elsewhere')).toBe(
		'one\ntwo\n… cut short, the rest is elsewhere'
	);
	// a single line longer than the limit is cut mid-line
	expect(cut('abcdefgh', 3, 'x')).toBe('abc\n… cut short, x');
});
