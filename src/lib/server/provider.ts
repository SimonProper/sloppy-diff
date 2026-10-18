import { env } from '$env/dynamic/private';
import { isAgentProvider, type AgentProvider } from '$lib/agent';

export const PROVIDER_COOKIE = 'ai-provider';

export function defaultProvider(): AgentProvider {
	const provider = env.AI_PROVIDER || 'claude';
	if (!isAgentProvider(provider)) {
		throw new Error('AI_PROVIDER must be claude or codex');
	}
	return provider;
}

export function providerFromCookie(value?: string): AgentProvider {
	return isAgentProvider(value) ? value : defaultProvider();
}

/** Provider-specific models keep a Claude model name from being passed to Codex. */
export function modelFor(
	provider: AgentProvider,
	purpose: 'guide' | 'ask' | 'explainer'
): string | undefined {
	if (provider === 'codex') {
		if (purpose === 'ask') return env.CODEX_ASK_MODEL || env.CODEX_MODEL;
		if (purpose === 'guide') return env.CODEX_GUIDE_MODEL || env.CODEX_MODEL;
		return env.CODEX_EXPLAINER_MODEL || env.CODEX_GUIDE_MODEL || env.CODEX_MODEL;
	}
	if (purpose === 'ask') return env.ASK_MODEL;
	if (purpose === 'guide') return env.GUIDE_MODEL;
	return env.EXPLAINER_MODEL || env.GUIDE_MODEL;
}
