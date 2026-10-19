import MarkdownIt from 'markdown-it';

/**
 * Markdown as the app renders model output, on the server and in the page alike. Raw HTML
 * is shown as text, never rendered, and markdown-it refuses javascript: and the like in
 * links. Images are off: one would load as soon as the page opens, a way to send data out
 * of a prompt injection.
 */
export function createMarkdown(highlight?: (code: string, lang: string) => string) {
	const md = new MarkdownIt({ html: false, linkify: true, highlight }).disable('image');
	// links open in a new tab instead of navigating the app away
	md.renderer.rules.link_open = (tokens, i, options, _env, self) => {
		tokens[i].attrSet('target', '_blank');
		tokens[i].attrSet('rel', 'noopener noreferrer');
		return self.renderToken(tokens, i, options);
	};
	return md;
}
