import { expect, test } from 'vitest';
import { cleanGithubHtml } from './github-html';

test("GitHub's HTML keeps its content, not its scripts, styles or hooks into the page", () => {
	const html = cleanGithubHtml(
		[
			'<p class="fixed inset-0" id="page" style="color:red" onclick="x()">Hi <a href="https://github.com/a/b/pull/1" class="issue-link">#1</a></p>',
			'<script>alert(1)</script>',
			'<a href="javascript:alert(1)">bad</a>',
			'<ul><li><input type="checkbox" checked> done</li></ul>',
			'<input type="text" value="x">',
			'<img src="https://camo.githubusercontent.com/abc" alt="shot">',
			'<img src="https://evil.example/track.gif">',
			'<img src="http://private-user-images.githubusercontent.com/1.png">',
			'<img src="https://github.com.evil.example/x.png">',
			'<details open="" class="details-reset border rounded-2">\n  <summary class="px-3 py-2">\n    <svg aria-hidden="true" class="octicon"><path d="M0 0"></path></svg>\n    <span aria-label="Video description demo.mp4" class="m-1">demo.mp4</span>\n    <span class="dropdown-caret"></span>\n  </summary>\n\n  <video src="https://private-user-images.githubusercontent.com/1.mp4?jwt=x" autoplay class="d-block">\n\n  </video>\n</details>',
			'<video src="https://evil.example/v.mp4"></video>',
			'<details><summary>Notes</summary><p>kept</p></details>',
			'<details><summary>v.mp4</summary><video src="https://github.com/user-attachments/assets/1"></video></details>'
		].join('')
	);
	expect(html).toBe(
		[
			'<p>Hi <a href="https://github.com/a/b/pull/1" target="_blank" rel="noopener noreferrer">#1</a></p>',
			'<a target="_blank" rel="noopener noreferrer">bad</a>',
			'<ul><li><input type="checkbox" checked disabled /> done</li></ul>',
			'<img src="https://camo.githubusercontent.com/abc" alt="shot" />',
			'<video src="https://private-user-images.githubusercontent.com/1.mp4?jwt=x" controls preload="metadata">\n\n  </video>',
			'<details><summary>Notes</summary><p>kept</p></details>',
			'<video src="https://github.com/user-attachments/assets/1" controls preload="metadata"></video>'
		].join('')
	);
});

test("code GitHub highlighted is highlighted again with the diff's grammars", () => {
	const html = cleanGithubHtml(
		'<div class="highlight highlight-source-ts notranslate position-relative overflow-auto" dir="auto"><pre><span class="pl-k">const</span> <span class="pl-c1">a</span> <span class="pl-c1">=</span> <span class="pl-s">"&lt;b&gt; &amp; \'c\'"</span></pre><div class="zeroclipboard-container"><clipboard-copy value="x"><svg></svg></clipboard-copy></div></div>'
	);
	expect(html).toContain('<pre class="twinkleplop"><code>');
	expect(html).toContain('<span class="tok keyword">const</span>');
	expect(html).toContain('&quot;&lt;b&gt; &amp; &#39;c&#39;&quot;');
	expect(html).not.toContain('pl-');
});

test('code in a language without a grammar, or a made-up one, stays plain', () => {
	expect(
		cleanGithubHtml(
			'<div class="highlight highlight-source-diff"><pre><span class="pl-md">-a &lt; b</span></pre></div>'
		)
	).toBe('<div><pre><span>-a &lt; b</span></pre></div>');
	expect(cleanGithubHtml('<pre lang="constructor">x</pre>')).toBe('<pre>x</pre>');
});

test('callouts keep their classes, headings lose their permalinks', () => {
	expect(
		cleanGithubHtml(
			'<div class="markdown-alert markdown-alert-warning fixed" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon"><path d="M0"></path></svg>Warning</p><p>Careful</p></div>'
		)
	).toBe(
		'<div class="markdown-alert markdown-alert-warning"><p class="markdown-alert-title">Warning</p><p>Careful</p></div>'
	);
	expect(
		cleanGithubHtml(
			'<div class="markdown-heading" dir="auto"><h2 tabindex="-1" class="heading-element" dir="auto">Why</h2><a id="user-content-why" class="anchor" aria-label="Permalink: Why" href="#why"><svg class="octicon"></svg></a></div>'
		)
	).toBe('<div><h2>Why</h2></div>');
	expect(
		cleanGithubHtml(
			'<a href="https://evil.example/x.png"><img src="https://evil.example/x.png"></a><a href="https://camo.githubusercontent.com/1"><img src="https://camo.githubusercontent.com/1"></a>'
		)
	).toBe(
		'<a href="https://camo.githubusercontent.com/1" target="_blank" rel="noopener noreferrer"><img src="https://camo.githubusercontent.com/1" /></a>'
	);
});
