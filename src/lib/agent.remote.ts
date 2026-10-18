import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { isAgentProvider } from './agent';
import { PROVIDER_COOKIE } from './server/provider';
import { requestProvider } from './server/provider-request';

export const getAgentProvider = query(() => requestProvider());

export const setAgentProvider = command('unchecked', (provider: unknown) => {
	if (!isAgentProvider(provider)) error(400, 'Choose Claude Code or Codex');
	const { cookies, url } = getRequestEvent();
	cookies.set(PROVIDER_COOKIE, provider, {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		secure: url.protocol === 'https:',
		maxAge: 60 * 60 * 24 * 365
	});
	getAgentProvider().set(provider);
	return provider;
});
