import { describe, expect, it } from 'vitest';
import { closeTerminal, listTerminals, openTerminal, watchTerminal } from './terminals';

describe('terminals', () => {
	it('runs the command in a shell in the worktree, replays it to a late watcher, and closes', async () => {
		const cwd = process.cwd();
		const term = openTerminal(cwd, '/repo', 'Run', 'echo "$SLOPPY_ROOT"; exit 3');
		const exit = await new Promise<number>((resolve) => {
			const stop = watchTerminal(term.id, (e) => 'exit' in e && (stop(), resolve(e.exit)));
		});
		expect(exit).toBe(3);
		let replay = '';
		watchTerminal(term.id, (e) => 'data' in e && (replay += e.data));
		expect(replay).toContain('/repo');
		expect(listTerminals(cwd)).toEqual([{ id: term.id, cwd, title: 'Run', exited: 3 }]);
		closeTerminal(term.id);
		expect(listTerminals(cwd)).toEqual([]);
	});
});

describe('a terminal started from inside another', () => {
	it("doesn't see that terminal's variables", async () => {
		process.env.HERDR_PANE_ID = 'p1';
		process.env.TERM_PROGRAM = 'ghostty';
		const term = openTerminal(
			process.cwd(),
			'/repo',
			'Terminal',
			'echo "[$HERDR_PANE_ID|$TERM_PROGRAM|$TERM]"; exit'
		);
		let out = '';
		await new Promise<void>((resolve) =>
			watchTerminal(term.id, (e) => ('data' in e ? (out += e.data) : resolve()))
		);
		closeTerminal(term.id);
		expect(out).toContain('[||xterm-256color]');
	});
});
