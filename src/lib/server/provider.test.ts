import { beforeEach, describe, expect, test, vi } from 'vitest';

const { settings } = vi.hoisted(() => ({ settings: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: settings }));
const { defaultProvider, providerFromCookie, modelFor } = await import('./provider');

beforeEach(() => {
	for (const key of Object.keys(settings)) delete settings[key];
});

describe('agent settings', () => {
	test('keeps Claude as the default and lets a browser override the environment', () => {
		expect(defaultProvider()).toBe('claude');
		settings.AI_PROVIDER = 'codex';
		expect(defaultProvider()).toBe('codex');
		expect(providerFromCookie('claude')).toBe('claude');
		expect(providerFromCookie('invalid')).toBe('codex');
		settings.AI_PROVIDER = 'unknown';
		expect(defaultProvider).toThrow('AI_PROVIDER must be claude or codex');
	});

	test('keeps Claude and Codex model overrides separate for every task', () => {
		Object.assign(settings, { GUIDE_MODEL: 'claude-guide', ASK_MODEL: 'claude-ask' });
		expect(modelFor('claude', 'explainer')).toBe('claude-guide');
		for (const purpose of ['guide', 'ask', 'explainer'] as const) {
			expect(modelFor('codex', purpose)).toBeUndefined();
		}
		settings.CODEX_MODEL = 'codex-default';
		expect(modelFor('codex', 'ask')).toBe('codex-default');
		settings.CODEX_GUIDE_MODEL = 'codex-guide';
		expect(modelFor('codex', 'explainer')).toBe('codex-guide');
		settings.CODEX_EXPLAINER_MODEL = 'codex-explainer';
		settings.CODEX_ASK_MODEL = 'codex-ask';
		expect(modelFor('codex', 'explainer')).toBe('codex-explainer');
		expect(modelFor('codex', 'ask')).toBe('codex-ask');
		expect(modelFor('claude', 'guide')).toBe('claude-guide');
		expect(modelFor('claude', 'ask')).toBe('claude-ask');
	});
});
