import { describe, expect, it } from 'vitest';
import { foldSteps, summarize, type Step } from './steps';
import { nextMode } from './types';

const tool = (name: string, title: string): Step => ({
	type: 'tool',
	id: title,
	name,
	title,
	done: true
});

describe('foldSteps', () => {
	it('folds each run of tool calls and thinking, leaving text between them', () => {
		const shown = foldSteps([
			{ type: 'thinking', text: 'hm' },
			tool('Read', 'a.ts'),
			{ type: 'text', text: 'Found it.' },
			{ type: 'thinking', text: '' },
			tool('Edit', 'a.ts')
		]);
		expect(shown.map((s) => (s.type === 'steps' ? s.steps.length : s.type))).toEqual([
			2,
			'text',
			1
		]);
	});
});

describe('summarize', () => {
	it('counts files once however often they were read or edited', () => {
		expect(
			summarize([
				{ type: 'thinking', text: 'hm' },
				tool('Read', 'a.ts'),
				tool('Read', 'a.ts'),
				tool('Read', 'b.ts'),
				tool('Bash', 'pnpm test'),
				tool('Edit', 'a.ts'),
				tool('Write', 'c.ts'),
				tool('Grep', 'foo'),
				tool('mcp__x__y', '')
			])
		).toBe('Thought · read 2 files · ran 1 command · edited 2 files · 1 search · 1 other step');
	});
});

describe('nextMode', () => {
	it('cycles as Claude Code does, never on to Bypass', () => {
		expect(nextMode('default')).toBe('acceptEdits');
		expect(nextMode('plan')).toBe('default');
		expect(nextMode('bypassPermissions')).toBe('default');
	});
});
