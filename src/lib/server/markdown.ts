import { createMarkdown } from '$lib/markdown';
import { fenceLanguage, highlightBlock } from './highlight';

// fenced code is highlighted by the grammars and theme the diff has, a language
// without one stays plain
export const markdown = createMarkdown((code, name) => {
	const lang = fenceLanguage(name);
	return (lang && highlightBlock(lang, code)) || '';
});
