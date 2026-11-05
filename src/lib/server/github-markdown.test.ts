import { expect, test } from 'vitest';
import { githubMarkdown } from './github-markdown';

const ID = '83990db3-511c-48e1-824f-ba7f12181d6b';
const SIGNED = `https://private-user-images.githubusercontent.com/1/2-${ID}.png?jwt=x&amp;y=1`;

test("a comment's raw HTML keeps its content, not its scripts, styles or hooks into the page", () => {
	const html = githubMarkdown(
		[
			'<p class="fixed inset-0" id="page" style="color:red" onclick="x()">Hi</p>',
			'<script>alert(1)</script>',
			'<a href="javascript:alert(1)">bad</a>',
			'<input type="text" value="x">',
			'<img src="https://evil.example/track.gif">',
			'<img src="http://private-user-images.githubusercontent.com/1.png">',
			'<img src="https://github.com.evil.example/x.png">',
			'<video src="https://evil.example/v.mp4"></video>',
			'<details><summary>Notes</summary><p>kept</p></details>'
		].join('\n'),
		''
	);
	expect(html).toBe(
		[
			'<p>Hi</p>\n\n',
			'<a target="_blank" rel="noopener noreferrer">bad</a>\n\n\n\n\n\n',
			'<details><summary>Notes</summary><p>kept</p></details>'
		].join('')
	);
});

test('a single newline is a line break, as on GitHub', () => {
	expect(githubMarkdown('one\ntwo\n\nthree', '')).toBe('<p>one<br />\ntwo</p>\n<p>three</p>\n');
});

test("uploads load from the signed URLs in GitHub's HTML, a bare link to a video plays it", () => {
	const video = `https://private-user-images.githubusercontent.com/1/3-${ID.replace('83', '84')}.mp4?jwt=v`;
	const html = githubMarkdown(
		[
			`![shot](https://github.com/user-attachments/assets/${ID})`,
			'',
			`<img width="300" alt="raw" src="https://github.com/user-attachments/assets/${ID}" />`,
			'',
			`https://github.com/user-attachments/assets/${ID.replace('83', '84')}`,
			'',
			'![badge](https://img.shields.io/x.svg?a=1&b=2)',
			'',
			'![gone](https://evil.example/x.png)'
		].join('\n'),
		[
			`<p><a href="${SIGNED}"><img src="${SIGNED}" alt="shot"></a></p>`,
			`<img width="300" src="${SIGNED}">`,
			`<video src="${video}"></video>`,
			'<img src="https://camo.githubusercontent.com/abc" data-canonical-src="https://img.shields.io/x.svg?a=1&amp;b=2">'
		].join('')
	);
	const signed = SIGNED.replace('&amp;', '&amp;');
	expect(html).toContain(`<img src="${signed}" alt="shot" />`);
	expect(html).toContain(`<img width="300" alt="raw" src="${signed}" />`);
	expect(html).toContain(`<p><video src="${video}" controls preload="metadata"></video></p>`);
	expect(html).toContain('<img src="https://camo.githubusercontent.com/abc" alt="badge" />');
	expect(html).not.toContain('evil');
	expect(html).not.toContain('gone');
});

test('mentions, issues, commits and emoji are linked where GitHub linked them, nowhere else', () => {
	const html = githubMarkdown(
		'Thanks @dziemba :tada: see #12928, cli/cli#7 and 173c7ba0eda9, CVE-2026-2454. Not @nobody, #99, 1234567 or :nope:\n\n`@dziemba #12928`',
		[
			'<a class="user-mention notranslate" href="https://github.com/dziemba">@dziemba</a>',
			'<a class="issue-link js-issue-link" href="https://github.com/cli/cli/issues/12928">#12928</a>',
			'<a class="issue-link" href="https://github.com/cli/cli/issues/7">cli/cli#7</a>',
			'<a class="commit-link" href="https://github.com/cli/cli/commit/173c7ba0eda984c9b26c150f5055efb180aeaf74"><tt>173c7ba</tt></a>',
			'<a title="CVE-2026-2454" data-hovercard-type="advisory" href="https://github.com/advisories/GHSA-3cx3-rw7f-7q37">CVE-2026-2454</a>',
			'<g-emoji class="g-emoji" alias="tada">🎉</g-emoji>'
		].join('')
	);
	const link = (href: string, text: string) =>
		`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
	expect(html).toBe(
		`<p>Thanks ${link('https://github.com/dziemba', '@dziemba')} 🎉 see ${link('https://github.com/cli/cli/issues/12928', '#12928')}, ${link('https://github.com/cli/cli/issues/7', 'cli/cli#7')} and ${link('https://github.com/cli/cli/commit/173c7ba0eda984c9b26c150f5055efb180aeaf74', '173c7ba0eda9')}, ${link('https://github.com/advisories/GHSA-3cx3-rw7f-7q37', 'CVE-2026-2454')}. Not @nobody, #99, 1234567 or :nope:</p>\n<p><code>@dziemba #12928</code></p>\n`
	);
});

test('callouts and task lists, as GitHub draws them', () => {
	expect(githubMarkdown('> [!WARNING]\n> Careful\n\n> [!note]\n>\n> Aside\n\n> plain', '')).toBe(
		[
			'<div class="markdown-alert markdown-alert-warning">\n<p class="markdown-alert-title">Warning</p>\n<p>Careful</p>\n</div>\n',
			'<div class="markdown-alert markdown-alert-note">\n<p class="markdown-alert-title">Note</p>\n<p>Aside</p>\n</div>\n',
			'<blockquote>\n<p>plain</p>\n</blockquote>\n'
		].join('')
	);
	expect(githubMarkdown('- [x] done\n- [ ] todo\n- [link](https://a.example)', '')).toBe(
		'<ul>\n<li><input type="checkbox" checked disabled /> done</li>\n<li><input type="checkbox" disabled /> todo</li>\n<li><a href="https://a.example" target="_blank" rel="noopener noreferrer">link</a></li>\n</ul>\n'
	);
});

test("code is highlighted with the diff's grammars, a language without one stays plain", () => {
	const html = githubMarkdown('```ts\nconst a = "<b> & \'c\'"\n```', '');
	expect(html).toContain('<pre class="twinkleplop"><code>');
	expect(html).toContain('<span class="tok keyword">const</span>');
	expect(html).toContain('&quot;&lt;b&gt; &amp; &#39;c&#39;&quot;');
	expect(githubMarkdown('```diff\n-a < b\n```', '')).toBe('<pre><code>-a &lt; b\n</code></pre>\n');
	expect(githubMarkdown('<pre lang="constructor">x</pre>', '')).toBe('<pre>x</pre>');
});

// GitHub's box for a suggestion, its rows as it draws them
const blob = (removed: string[], added: string[]) =>
	`<div class="my-2 border rounded-2 js-suggested-changes-blob diff-view" id=""><table><tbody>${[
		...removed.map(
			(l) =>
				`<tr><td class="blob-num blob-num-deletion" data-line-number="1"></td><td class="blob-code-inner blob-code-deletion js-blob-code-deletion">${l}</td></tr>`
		),
		...added.map((l) => `<tr><td class="blob-code-inner blob-code-addition">${l}</td></tr>`)
	].join('')}</tbody></table></div>`;

test('a suggestion shows the lines it replaced, as GitHub has them, then what it puts', () => {
	const html = githubMarkdown(
		'Shorter:\n\n```suggestion\nb, c := 3, 4\n```\n\nAnd:\n\n```suggestion\n```',
		// applied since: the diff has the new lines, GitHub's box still the old ones
		blob(
			['<span class="pl-s1">b</span> := <span class="x">2</span>', 'c := &quot;4&quot;'],
			['b, c := 3, 4']
		) + blob([''], []),
		'a.go'
	);
	expect(html.replace(/<(?!\/?div)[^>]*>/g, '')).toBe(
		[
			'Shorter:\n',
			'<div class="suggested">Suggested change<div class="suggested-old">b := 2\nc := &quot;4&quot;</div><div class="suggested-new">b, c := 3, 4</div></div>\n',
			'And:\n',
			// deleting a blank line
			'<div class="suggested">Suggested change<div class="suggested-old"></div></div>\n'
		].join('')
	);
	expect(html).toContain('<span class="tok number">3</span>');
	// on no lines, a comment on the pull request: just what it puts, plain
	expect(githubMarkdown('```suggestion\n<b>\n```', '')).toBe(
		'<div class="suggested"><p class="suggested-title">Suggested change</p><div class="suggested-new"><pre><code>&lt;b&gt;</code></pre></div></div>\n'
	);
});
