import { afterAll, describe, expect, it } from 'vitest';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	branchFor,
	describe as describeTool,
	followBackground,
	followTask,
	fresh,
	fromTranscript,
	stitch,
	wrapperArgs
} from './agents';
import type { Session } from '$lib/agents/types';
import { abortOperation, pull, rebase, syncOf } from './sync';

describe('wrapperArgs', () => {
	it('fills in the worktree and repo, keeping quoted words together', () => {
		expect(wrapperArgs(`nono run --allow {worktree} --allow "{repo}/a b" --`, '/w', '/r')).toEqual([
			'nono',
			'run',
			'--allow',
			'/w',
			'--allow',
			'/r/a b',
			'--'
		]);
	});

	it('is nothing for an empty wrapper', () => {
		expect(wrapperArgs('  ', '/w', '/r')).toEqual([]);
	});
});

describe('describe', () => {
	it('shows an edit as removed and added lines, relative to the worktree', () => {
		expect(
			describeTool('Edit', { file_path: '/w/src/a.ts', old_string: 'a\nb', new_string: 'c' }, '/w')
		).toEqual({ title: 'src/a.ts', detail: '-a\n-b\n+c' });
	});
});

describe('fromTranscript', () => {
	const message = (type: 'user' | 'assistant', content: unknown, parent: string | null = null) =>
		({
			type,
			uuid: '',
			session_id: '',
			message: { content },
			parent_tool_use_id: parent,
			parent_agent_id: null
		}) as SessionMessage;

	it("reads messages, tool calls with their results, and leaves the terminal's own out", () => {
		const items = fromTranscript(
			[
				message('user', '<command-name>/clear</command-name>'),
				message('user', 'fix the bug'),
				message('assistant', [{ type: 'thinking', thinking: 'hmm' }]),
				message('assistant', [
					{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/w/a.ts' } }
				]),
				message('user', [
					{ type: 'tool_result', tool_use_id: 't1', content: 'code', is_error: false }
				]),
				message('assistant', [{ type: 'text', text: 'subagent says hi' }], 't1'),
				message('assistant', [{ type: 'text', text: 'Fixed.' }])
			],
			'/w'
		);
		expect(items.map((i) => i.type)).toEqual(['user', 'thinking', 'tool', 'text']);
		expect(items[2]).toMatchObject({ name: 'Read', title: 'a.ts', output: 'code', failed: false });
		expect(items[3]).toEqual({ type: 'text', text: 'Fixed.' });
	});
});

describe('stitch', () => {
	const row = (uuid: string, parentUuid: string | null, extra: object = {}) =>
		JSON.stringify({ type: 'user', uuid, parentUuid, message: { content: uuid }, ...extra });

	it('follows a compaction back to the conversation it summarised, on the branch in use', () => {
		const messages = stitch([
			row('a', null),
			row('b', 'a'),
			row('rewound', 'a'),
			row('side', 'b', { isSidechain: true }),
			JSON.stringify({
				type: 'system',
				subtype: 'compact_boundary',
				uuid: 'c',
				parentUuid: null,
				logicalParentUuid: 'b'
			}),
			row('summary', 'c', { isCompactSummary: true }),
			row('meta', 'summary', { isMeta: true }),
			row('e', 'meta'),
			row('report', 'e', { origin: { kind: 'peer' } }),
			row('notice', 'report', { origin: { kind: 'task-notification' } }),
			JSON.stringify({
				type: 'user',
				uuid: 'result',
				parentUuid: 'notice',
				origin: { kind: 'peer' },
				message: { content: [{ type: 'tool_result', tool_use_id: 't' }] }
			}),
			row('typed', 'result', { origin: { kind: 'human' } }),
			'{"half a line'
		]);
		expect(messages.map((m) => (m.type === 'system' ? 'compacted' : m.uuid))).toEqual([
			'a',
			'b',
			'compacted',
			'e',
			'result',
			'typed'
		]);
	});
});

describe("a subagent's transcript", () => {
	it('reads its own conversation, all sidechain, which the main one leaves out', () => {
		const row = (uuid: string, parentUuid: string | null, type: string, content: unknown) =>
			JSON.stringify({
				uuid,
				parentUuid,
				type,
				isSidechain: true,
				message: { role: type, content }
			});
		const lines = [
			row('1', null, 'user', 'Find the auth code'),
			row('2', '1', 'assistant', [
				{ type: 'tool_use', id: 't', name: 'Grep', input: { pattern: 'auth' } }
			]),
			row('3', '2', 'user', [{ type: 'tool_result', tool_use_id: 't', content: 'src/auth.ts' }]),
			row('4', '3', 'assistant', [{ type: 'text', text: 'It is in src/auth.ts' }])
		];
		expect(stitch(lines)).toEqual([]);
		expect(
			fromTranscript(stitch(lines, true), '/w').map((i) => [
				i.type,
				'text' in i ? i.text : i.type === 'tool' && i.output
			])
		).toEqual([
			['user', 'Find the auth code'],
			['tool', 'src/auth.ts'],
			['text', 'It is in src/auth.ts']
		]);
	});
});

describe('subagents', () => {
	const ids = { uuid: '0-0-0-0-0', session_id: 's' } as const;
	const entry = () => fresh({ status: 'running', items: [], tasks: [] } as unknown as Session);

	it('follows them from start to end, leaving shells and housekeeping out', () => {
		const e = entry();
		followTask(e, {
			...ids,
			type: 'system',
			subtype: 'task_started',
			task_id: 'a',
			tool_use_id: 't1',
			description: 'Explore auth',
			task_type: 'local_agent'
		});
		followTask(e, {
			...ids,
			type: 'system',
			subtype: 'task_started',
			task_id: 'b',
			description: 'pnpm dev',
			task_type: 'local_bash'
		});
		followTask(e, {
			...ids,
			type: 'system',
			subtype: 'task_started',
			task_id: 'c',
			description: 'x',
			task_type: 'local_agent',
			ambient: true
		});
		followTask(e, {
			...ids,
			type: 'system',
			subtype: 'task_progress',
			task_id: 'a',
			description: 'Explore auth',
			last_tool_name: 'Read',
			usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 }
		});
		expect(e.session.tasks).toEqual([
			{ id: 'a', toolUseId: 't1', description: 'Explore auth', background: false, doing: 'Read' }
		]);
		followTask(e, {
			...ids,
			type: 'system',
			subtype: 'task_updated',
			task_id: 'a',
			patch: { is_backgrounded: true }
		});
		expect(e.session.tasks?.[0].background).toBe(true);
		followTask(e, {
			...ids,
			type: 'system',
			subtype: 'task_notification',
			task_id: 'a',
			status: 'completed',
			output_file: '',
			summary: ''
		});
		expect(e.session.tasks).toEqual([]);
	});

	it("takes the background ones from Claude Code's set, one whose end was missed gone", () => {
		const e = entry();
		followTask(e, {
			...ids,
			type: 'system',
			subtype: 'task_started',
			task_id: 'a',
			description: 'old',
			task_type: 'local_agent',
			is_backgrounded: true
		});
		followTask(e, {
			...ids,
			type: 'system',
			subtype: 'task_started',
			task_id: 'f',
			description: 'waited on',
			task_type: 'local_agent'
		});
		followBackground(e, {
			...ids,
			type: 'system',
			subtype: 'background_tasks_changed',
			tasks: [
				{ task_id: 'b', task_type: 'local_agent', description: 'new' },
				{ task_id: 'd', task_type: 'local_bash', description: 'pnpm dev' }
			]
		});
		expect(e.session.tasks?.map((t) => [t.id, t.background])).toEqual([
			['f', false],
			['b', true]
		]);
	});
});

describe('a worktree', () => {
	const repo = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-agents-test-')));
	const git = (...args: string[]) =>
		execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
	git('init', '-q', '-b', 'main');
	// the stash and the rebased commits need someone to be by, as they do outside a test
	git('config', 'user.name', 't');
	git('config', 'user.email', 't@t');
	writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
	git('add', '.');
	git('commit', '-qm', 'first');
	afterAll(() => rmSync(repo, { recursive: true, force: true }));

	it('gets a branch named after what it was asked, one that is free', async () => {
		expect(await branchFor(repo, 'Fix the *weird* sidebar!\nand more')).toBe(
			'fix-the-weird-sidebar'
		);
		git('branch', 'fix-the-weird-sidebar');
		expect(await branchFor(repo, 'Fix the weird sidebar')).toBe('fix-the-weird-sidebar-2');
	});

	it('counts what it has uncommitted, and nothing upstream without one', async () => {
		writeFileSync(join(repo, 'a.txt'), 'one\n2\nthree\n');
		expect(await syncOf(repo, null)).toEqual({ added: 2, removed: 1, dirty: true });
		git('checkout', '-q', '--', 'a.txt');
	});

	it('stops a rebase on its conflicts, and aborts it', async () => {
		git('checkout', '-q', '-b', 'feature');
		writeFileSync(join(repo, 'a.txt'), 'one\nfeature\n');
		git('commit', '-qam', 'feature');
		git('checkout', '-q', 'main');
		writeFileSync(join(repo, 'a.txt'), 'one\nmain\n');
		git('commit', '-qam', 'main');
		git('checkout', '-q', 'feature');

		expect(await syncOf(repo, 'main')).toMatchObject({ base: 'main', behindBase: 1, aheadBase: 1 });
		expect(await rebase(repo, 'main')).toEqual({ conflicts: ['a.txt'] });
		expect((await syncOf(repo, 'main')).conflicts).toEqual(['a.txt']);
		await abortOperation(repo);
		expect((await syncOf(repo, 'main')).conflicts).toBeUndefined();
	});

	it('counts an upstream that is the base once, as the base', async () => {
		git('checkout', '-q', '-b', 'tracking', 'main~1');
		git('branch', '-q', '--set-upstream-to', 'main');
		const sync = await syncOf(repo, 'main');
		expect(sync).toMatchObject({ behindBase: 1, aheadBase: 0 });
		expect(sync.behind).toBeUndefined();
		git('checkout', '-q', 'feature');
	});

	it("tells a merge stopped on conflicts from a stash's, and aborts it", async () => {
		git('checkout', '-q', '-b', 'merging', 'feature');
		expect(() => git('merge', '-q', 'main')).toThrow();
		const sync = await syncOf(repo, 'main');
		expect(sync).toMatchObject({ operation: 'merge', conflicts: ['a.txt'] });
		expect(sync.stashConflict).toBeUndefined();
		await abortOperation(repo);
		expect((await syncOf(repo, 'main')).operation).toBeUndefined();
		git('checkout', '-q', 'feature');
	});

	it('rebases with uncommitted work, stashed and put back', async () => {
		git('checkout', '-q', '-b', 'dirty', 'main~1');
		writeFileSync(join(repo, 'b.txt'), 'mine\n');
		git('add', 'b.txt');
		git('commit', '-qm', 'b');
		writeFileSync(join(repo, 'b.txt'), 'mine, more\n');
		expect(await rebase(repo, 'main')).toEqual({});
		expect(await syncOf(repo, 'main')).toMatchObject({ behindBase: 0, dirty: true });
		git('checkout', '-q', '--', 'b.txt');
	});

	it('says when the stashed work conflicts going back, kept in the stash', async () => {
		git('checkout', '-q', '-b', 'clash', 'main~1');
		writeFileSync(join(repo, 'a.txt'), 'one\nmine\n');
		expect(await rebase(repo, 'main')).toEqual({ stashConflicts: ['a.txt'] });
		const sync = await syncOf(repo, 'main');
		expect(sync.conflicts).toEqual(['a.txt']);
		expect(sync.operation).toBeUndefined();
		expect(sync.stashConflict).toBe(true);
		expect(git('stash', 'list').toString().trim()).not.toBe('');
		git('reset', '-q', '--hard');
		git('stash', 'drop', '-q');
	});

	it('fast-forwards to its upstream, and refuses when it would have to merge', async () => {
		git('checkout', '-q', '-b', 'behind', 'main~1');
		git('branch', '-q', '--set-upstream-to', 'main');
		expect(await syncOf(repo, null)).toMatchObject({ behind: 1, ahead: 0 });
		await pull(repo);
		expect(await syncOf(repo, null)).toMatchObject({ behind: 0, ahead: 0 });
		git('checkout', '-q', 'feature');
		git('branch', '-q', '--set-upstream-to', 'main');
		await expect(pull(repo)).rejects.toThrow();
	});
});
