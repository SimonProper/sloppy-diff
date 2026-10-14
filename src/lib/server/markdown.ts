import MarkdownIt from 'markdown-it';
import { fenceLanguage, highlightBlock } from './highlight';

// raw HTML in model output is shown as text, never rendered. Images are off: one
// would load as soon as the page opens, a way to send data out of a prompt injection.
// Fenced code is highlighted by the grammars and theme the diff has, a language
// without one stays plain
export const markdown = new MarkdownIt({
	html: false,
	linkify: true,
	highlight: (code, name) => {
		const lang = fenceLanguage(name);
		return (lang && highlightBlock(lang, code)) || '';
	}
}).disable('image');
// links open in a new tab instead of navigating the app away
markdown.renderer.rules.link_open = (tokens, i, options, _env, self) => {
	tokens[i].attrSet('target', '_blank');
	tokens[i].attrSet('rel', 'noopener noreferrer');
	return self.renderToken(tokens, i, options);
};
