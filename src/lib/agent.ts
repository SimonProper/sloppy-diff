export type AgentProvider = 'claude' | 'codex';

export const AGENT_PROVIDERS: { value: AgentProvider; label: string }[] = [
	{ value: 'claude', label: 'Claude Code' },
	{ value: 'codex', label: 'Codex' }
];

export function isAgentProvider(value: unknown): value is AgentProvider {
	return value === 'claude' || value === 'codex';
}

export function providerLabel(provider: AgentProvider): string {
	return provider === 'codex' ? 'Codex' : 'Claude Code';
}
