import { describe, expect, it } from 'vitest';
import type { PrSummary } from '$lib/pr/types';
import type { SessionSummary, WorktreeStatus } from './types';
import {
	firstTabs,
	linkedPr,
	loudest,
	moveTab,
	reordered,
	tabKeys,
	worktreeOfPr,
	type Tabs
} from './places';

const pr = (number: number, headRefName: string, baseRefName = 'main') =>
	({ number, headRefName, baseRefName }) as PrSummary;
const session = (over: Partial<SessionSummary>) =>
	({
		id: 'x',
		open: true,
		waiting: false,
		unread: false,
		status: 'idle',
		...over
	}) as SessionSummary;
const tree = (path: string, over: Partial<WorktreeStatus> = {}) =>
	({ path, branch: path.slice(1), main: false, sessions: [], ...over }) as WorktreeStatus;

describe('linkedPr', () => {
	const prs = [pr(1, 'fix-login'), pr(2, 'main', 'main')];
	it('matches a worktree to the PR from its branch', () => {
		expect(linkedPr({ branch: 'fix-login', path: '/w/fix-login' }, prs)?.number).toBe(1);
		expect(worktreeOfPr(1, [tree('/other'), tree('/fix-login')], prs)?.path).toBe('/fix-login');
	});
	it("matches one Check out made by its name, a fork's main too", () => {
		expect(linkedPr({ branch: 'main', path: '/w/pr-2' }, prs)?.number).toBe(2);
		expect(linkedPr({ branch: null, path: '/w/pr-1' }, prs)?.number).toBe(1);
	});
	it("doesn't link a detached worktree or a fork's PR from the base branch", () => {
		expect(linkedPr({ branch: null, path: '/w/x' }, prs)).toBeNull();
		expect(linkedPr({ branch: 'main', path: '/w/main' }, prs)).toBeNull();
	});
});

describe('loudest', () => {
	it('picks needing you over working over done, and nothing when all are idle', () => {
		const done = session({ id: 'done', unread: true });
		const working = session({ id: 'working', status: 'running' });
		const waiting = session({ id: 'waiting', waiting: true });
		expect(loudest([done, working, waiting])?.id).toBe('waiting');
		expect(loudest([done, working])?.id).toBe('working');
		expect(loudest([session({}), session({ waiting: true, open: false })])).toBeNull();
	});
});

describe('tabs', () => {
	const main = tree('/main', { main: true });
	const busy = tree('/busy', { sessions: [session({})] });
	const quiet = tree('/quiet');
	const trees = [main, quiet, busy];
	const none: Tabs = { order: [], closed: [], prs: [], preview: null };

	it('opens the main checkout and the worktrees with an agent or a PR at first', () => {
		expect(tabKeys(firstTabs(trees, []), trees, [])).toEqual(['/main', '/busy']);
		expect(tabKeys(firstTabs(trees, [pr(3, 'quiet')]), trees, [])).toEqual([
			'/main',
			'/quiet',
			'/busy'
		]);
	});

	it('keeps the main checkout first and new worktrees open, in the order dragged into', () => {
		expect(tabKeys({ ...none, order: ['/busy'] }, trees, [])).toEqual(['/main', '/busy', '/quiet']);
	});

	it('puts kept pull requests then the preview last, dropping ones checked out since', () => {
		const tabs = { ...none, prs: [5, 6], preview: 7 };
		expect(tabKeys(tabs, [main], [])).toEqual(['/main', '#5', '#6', '#7']);
		expect(tabKeys(tabs, [main, tree('/w/pr-6')], [pr(6, 'x')])).toEqual([
			'/main',
			'/w/pr-6',
			'#5',
			'#7'
		]);
	});

	it('moves tabs among their own kind, a dragged preview kept', () => {
		const keys = ['/main', '/a', '/b', '#1', '#2'];
		expect(moveTab(keys, '/a', '/b')).toEqual(['/main', '/b', '/a', '#1', '#2']);
		expect(moveTab(keys, '/b', '/a')).toEqual(['/main', '/b', '/a', '#1', '#2']);
		expect(moveTab(keys, '#1', '/a')).toBe(keys);
		const tabs = { ...none, order: ['/c'], prs: [1], preview: 2 };
		expect(reordered(tabs, moveTab(keys, '#2', '#1'))).toEqual({
			order: ['/main', '/a', '/b', '/c'],
			closed: [],
			prs: [2, 1],
			preview: null
		});
	});
});
