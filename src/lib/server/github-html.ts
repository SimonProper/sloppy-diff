import sanitizeHtml from 'sanitize-html';
import { detectLanguage, highlightBlock, isLanguage, type Language } from './highlight';

// images and videos only from GitHub's own hosts: its image proxy, attachments, avatars. One from
// anywhere else would load as soon as the page opens, telling that host who's looking
function fromGithub(src: string | undefined): boolean {
	try {
		const { protocol, hostname } = new URL(src ?? '');
		return (
			protocol === 'https:' &&
			(hostname === 'github.com' || hostname.endsWith('.githubusercontent.com'))
		);
	} catch {
		return false;
	}
}

// the summary can't run on past its own end, into another box before the video's
const UPLOADED_VIDEO =
	/<details[^>]*>\s*<summary[^>]*>(?:(?!<\/summary>)[\s\S])*<\/summary>\s*(<video[\s\S]*?<\/video>)\s*<\/details>/g;

// GitHub names a code block's language by its grammar's scope, `highlight-source-ts`
const HIGHLIGHTED =
	/<div class="highlight highlight-(?:source|text)-([^\s"]+)[^"]*"[^>]*>\s*<pre[^>]*>/g;
const SCOPES: Record<string, Language> = {
	'c++': 'cpp',
	shell: 'bash',
	'html-basic': 'html',
	'js-jsx': 'tsx'
};
const languageOf = (scope: string): Language | null =>
	SCOPES[scope] ?? (isLanguage(scope) ? scope : detectLanguage(`x.${scope}`));

const ALERTS = ['note', 'tip', 'important', 'warning', 'caution'].map((k) => `markdown-alert-${k}`);

const clean = (html: string): string =>
	sanitizeHtml(html, {
		allowedTags: [
			...sanitizeHtml.defaults.allowedTags,
			'img',
			'video',
			'del',
			'ins',
			'details',
			'summary',
			'input'
		],
		allowedAttributes: {
			a: ['href', 'target', 'rel'],
			img: ['src', 'alt', 'title', 'width', 'height'],
			video: ['src', 'controls', 'muted', 'preload'],
			// task list checkboxes
			input: ['type', 'checked', 'disabled'],
			// the language a code block is highlighted in
			pre: ['lang'],
			th: ['align'],
			td: ['align'],
			ol: ['start'],
			details: ['open']
		},
		// callouts, `> [!NOTE]`, are the only classes that stay: the page styles them
		allowedClasses: { div: ['markdown-alert', ...ALERTS], p: ['markdown-alert-title'] },
		allowedSchemesByTag: { img: ['https'], video: ['https'] },
		exclusiveFilter: (frame) =>
			((frame.tag === 'img' || frame.tag === 'video') && !fromGithub(frame.attribs.src)) ||
			(frame.tag === 'input' && frame.attribs.type !== 'checkbox') ||
			// a heading's permalink icon, or an image's link once the image is gone
			(frame.tag === 'a' && !frame.text.trim() && frame.mediaChildren.length === 0),
		transformTags: {
			a: (tagName, attribs) => ({
				tagName,
				attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
			}),
			input: (tagName, attribs) => ({ tagName, attribs: { ...attribs, disabled: '' } }),
			// played when asked, never on its own, and only its size and length loaded up front
			video: (tagName, attribs) => ({
				tagName,
				attribs: { ...attribs, controls: '', preload: 'metadata' }
			})
		}
	});

// what's left of a code block once it's clean: tags and the few entities sanitize-html writes
const codeText = (html: string): string =>
	html
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&');

/**
 * Markdown as GitHub rendered it (`bodyHTML`), cut down to what the page shows. GitHub
 * sanitizes it already, this doesn't take its word for it: no ids or styles and no
 * classes but the callouts', to reach the app's own CSS or DOM, links open in a new tab
 * like ours do. Code is highlighted again, by the grammars and theme the diff has.
 */
export function cleanGithubHtml(html: string): string {
	const marked = html
		// GitHub puts an uploaded video in a box to fold away, titled with its file name: just the video
		.replace(UPLOADED_VIDEO, '$1')
		.replace(HIGHLIGHTED, (block, scope: string) => {
			const lang = languageOf(scope);
			return lang ? `<div><pre lang="${lang}">` : block;
		});
	return clean(marked).replace(
		/<pre lang="([^"]*)">([\s\S]*?)<\/pre>/g,
		(_, lang: string, code: string) =>
			(isLanguage(lang) && highlightBlock(lang, codeText(code))) || `<pre>${code}</pre>`
	);
}
