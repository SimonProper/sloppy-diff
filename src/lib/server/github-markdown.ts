import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { detectLanguage, fenceLanguage, highlightBlock, isLanguage } from './highlight';

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

const decode = (html: string): string =>
	html
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&');

// what's left of a code block once it's clean: its text
const codeText = (html: string): string => decode(html.replace(/<[^>]*>/g, ''));

const attributes = (tag: string): Record<string, string> =>
	Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));

/** What only GitHub knows about a comment, read off its own rendering of it. */
type Known = {
	// an upload's id to the signed URL it loads from: the markdown's link to it needs a login
	uploads: Map<string, { src: string; video: boolean }>;
	// an image from elsewhere to GitHub's proxy of it
	proxied: Map<string, string>;
	// `@user`, `@org/team`, `#12`, `owner/repo#12` and `CVE-2026-1` as typed, to where GitHub linked them
	refs: Map<string, string>;
	commits: string[];
	// `tada` to 🎉
	emoji: Map<string, string>;
	// the lines each ```suggestion replaces, in order, as they were when it was made: once
	// it's applied the diff has what it put instead
	replaced: (string | null)[];
};

const UPLOAD = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function known(html: string): Known {
	const k: Known = {
		uploads: new Map(),
		proxied: new Map(),
		refs: new Map(),
		commits: [],
		emoji: new Map(),
		replaced: html
			.split(/class="[^"]*\bjs-suggested-changes-blob\b/)
			.slice(1)
			.map((blob) => {
				const rows = [...blob.matchAll(/<td\b[^>]*\bblob-code-deletion\b[^>]*>([\s\S]*?)<\/td>/g)];
				return rows.length ? rows.map(([, code]) => codeText(code)).join('\n') : null;
			})
	};
	for (const [, tag, rest] of html.matchAll(/<(img|video)\b([^>]*)>/g)) {
		const { src, 'data-canonical-src': original } = attributes(rest);
		if (!src) continue;
		const id = UPLOAD.exec(src)?.[0];
		if (id) k.uploads.set(id, { src, video: tag === 'video' });
		if (original) k.proxied.set(original, src);
	}
	for (const [, rest, text] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
		const { class: names = '', href, 'data-hovercard-type': card } = attributes(rest);
		if (!href) continue;
		if (/\bcommit-link\b/.test(names)) k.commits.push(href);
		else if (/\b(?:user-mention|team-mention|issue-link)\b/.test(names) || card === 'advisory')
			k.refs.set(codeText(text).trim(), href);
	}
	for (const [, rest, char] of html.matchAll(/<g-emoji\b([^>]*)>([^<]*)<\/g-emoji>/g)) {
		const { alias } = attributes(rest);
		if (alias) k.emoji.set(alias, char);
	}
	return k;
}

const resolve = (k: Known, src = ''): string =>
	k.uploads.get(UPLOAD.exec(src)?.[0] ?? '')?.src ?? k.proxied.get(src) ?? src;

// what GitHub may have linked in plain text. Only what it did link is, a number that looks
// like a commit stays a number
const REF =
	/(?<![\w@#/.-])(?:@[\w-]+(?:\/[\w-]+)?|(?:[\w.-]+\/[\w.-]+)?#\d+|(?:[\w.-]+\/[\w.-]+@)?[0-9a-f]{7,40}|:[\w+-]+:|CVE-\d+-\d+|GHSA(?:-[a-z0-9]{4}){3})(?![\w/-])/g;

function linkOf(k: Known, word: string): string | undefined {
	const commit = /^(?:([\w.-]+\/[\w.-]+)@)?([0-9a-f]{7,40})$/.exec(word);
	if (!commit) return k.refs.get(word);
	const [, repo = '', sha] = commit;
	return k.commits.find((href) => href.includes(`${repo}/commit/${sha}`));
}

const ALERT = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;

// a single newline is a line break in a comment, as on GitHub. Raw HTML is let through to
// the sanitizer: comments use <details>, <img width> and the like
const md = new MarkdownIt({ html: true, breaks: true, linkify: true });
// marked with its language to highlight once it's clean, the sanitizer would drop the colours
md.set({
	highlight: (code, name) => {
		const lang = name === 'suggestion' ? name : fenceLanguage(name);
		return lang ? `<pre lang="${lang}"><code>${md.utils.escapeHtml(code)}</code></pre>` : '';
	}
});

// GitHub's own blocks: `- [x] task` and `> [!NOTE]` callouts
md.core.ruler.after('block', 'github_blocks', (state) => {
	const tokens = state.tokens;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.type === 'inline' && tokens[i - 2]?.type === 'list_item_open')
			token.content = token.content.replace(
				/^\[([ xX])\][ \t]+/,
				(_, mark: string) => `<input type="checkbox"${mark === ' ' ? '' : ' checked'}> `
			);
		const kind =
			token.type === 'blockquote_open' &&
			tokens[i + 2]?.type === 'inline' &&
			ALERT.exec(tokens[i + 2].content);
		if (!kind) continue;
		const name = kind[1].toLowerCase();
		const close = tokens.findIndex(
			(t, j) => j > i && t.type === 'blockquote_close' && t.level === token.level
		);
		token.tag = tokens[close].tag = 'div';
		token.attrSet('class', `markdown-alert markdown-alert-${name}`);
		const title = new state.Token('html_block', '', 0);
		title.content = `<p class="markdown-alert-title">${name[0].toUpperCase()}${name.slice(1)}</p>\n`;
		const first = tokens[i + 2];
		first.content = first.content.slice(kind[0].length);
		// the marker alone in its paragraph leaves nothing of it
		tokens.splice(i + 1, first.content ? 0 : 3, title);
	}
});

// mentions, issues, commits and emoji where GitHub found them, outside links and code
md.core.ruler.push('github_refs', (state) => {
	const k = state.env as Known;
	const text = (content: string) => Object.assign(new state.Token('text', '', 0), { content });
	for (const block of state.tokens) {
		if (block.type !== 'inline' || !block.children) continue;
		let linked = 0;
		block.children = block.children.flatMap((token) => {
			if (token.type === 'link_open') linked++;
			if (token.type === 'link_close') linked--;
			if (token.type !== 'text' || linked) return [token];
			const out = [];
			let at = 0;
			for (const { 0: word, index } of token.content.matchAll(REF)) {
				const emoji = word.startsWith(':') ? k.emoji.get(word.slice(1, -1)) : undefined;
				const href = emoji ? undefined : linkOf(k, word);
				if (!emoji && !href) continue;
				out.push(text(token.content.slice(at, index)));
				if (emoji) out.push(text(emoji));
				else {
					const open = new state.Token('link_open', 'a', 1);
					open.attrSet('href', href!);
					out.push(open, text(word), new state.Token('link_close', 'a', -1));
				}
				at = index + word.length;
			}
			if (!at) return [token];
			out.push(text(token.content.slice(at)));
			return out;
		});
	}
});

const ALERTS = ['note', 'tip', 'important', 'warning', 'caution'].map((k) => `markdown-alert-${k}`);

const clean = (html: string, k: Known): string =>
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
			// an image's link once the image is gone. A video made of a link is still an `a` here
			(frame.tag === 'a' &&
				'href' in frame.attribs &&
				!frame.text.trim() &&
				frame.mediaChildren.length === 0),
		transformTags: {
			// a video is uploaded as a bare link to it, GitHub plays it in place
			a: (tagName, attribs): sanitizeHtml.Tag => {
				const upload = k.uploads.get(UPLOAD.exec(attribs.href ?? '')?.[0] ?? '');
				return upload?.video && fromGithub(upload.src)
					? {
							tagName: 'video',
							attribs: { src: upload.src, controls: '', preload: 'metadata' },
							text: ''
						}
					: { tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } };
			},
			img: (tagName, attribs) => ({
				tagName,
				attribs: { ...attribs, src: resolve(k, attribs.src) }
			}),
			input: (tagName, attribs) => ({ tagName, attribs: { ...attribs, disabled: '' } }),
			// played when asked, never on its own, and only its size and length loaded up front
			video: (tagName, attribs) => ({
				tagName,
				attribs: { ...attribs, src: resolve(k, attribs.src), controls: '', preload: 'metadata' }
			})
		}
	});

/**
 * A ```suggestion as GitHub shows it: the lines it replaces, then what it puts in their place.
 * Without the lines, on a comment that isn't on any, just what it puts.
 */
function suggested(code: string, old: string | null, path: string | undefined): string {
	const lang = path && detectLanguage(path);
	const block = (text: string) =>
		(lang && highlightBlock(lang, text)) || `<pre><code>${md.utils.escapeHtml(text)}</code></pre>`;
	return [
		'<div class="suggested"><p class="suggested-title">Suggested change</p>',
		// a blank line replaced is still one
		old !== null ? `<div class="suggested-old">${block(old)}</div>` : '',
		// an empty one deletes the lines
		code ? `<div class="suggested-new">${block(code)}</div>` : '',
		'</div>'
	].join('');
}

/**
 * A comment's markdown, rendered the app's way: GitHub's own rendering (`bodyHTML`) only
 * says what it alone knows, the signed URLs uploads load from, which mentions, issues and
 * commits exist, emoji, and the lines a suggestion replaces. Raw HTML goes through the sanitizer: no ids or styles and no
 * classes but the callouts', to reach the app's own CSS or DOM, links open in a new tab
 * like ours do. Code is highlighted by the grammars and theme the diff has.
 */
export function githubMarkdown(markdown: string, githubHtml: string, path?: string): string {
	const k = known(githubHtml);
	let n = 0;
	return clean(md.render(markdown, k), k).replace(
		/<pre lang="([^"]*)">([\s\S]*?)<\/pre>/g,
		(_, lang: string, code: string) =>
			lang === 'suggestion'
				? suggested(codeText(code).replace(/\n$/, ''), k.replaced[n++] ?? null, path)
				: (isLanguage(lang) && highlightBlock(lang, codeText(code))) || `<pre>${code}</pre>`
	);
}
