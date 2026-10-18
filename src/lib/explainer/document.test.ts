import { describe, expect, test } from 'vitest';
import { explainerDocument } from './document';

describe('explainer document', () => {
	test('installs its policy before any generated markup, including scripts before the head', () => {
		const doc = explainerDocument(
			'<!DOCTYPE html><script>globalThis.ran = true</script><html><head></head><body></body></html>'
		);
		expect(doc.match(/<!doctype/gi)).toHaveLength(1);
		expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script>'));
		expect(doc).toContain("default-src 'none'");
		expect(doc).toContain("connect-src 'none'");
		expect(doc).toContain("form-action 'none'");
		expect(doc).toContain("frame-src 'none'");
	});

	test('permits the template scripts and retains their contents', () => {
		const html = '<html><script type="module">const example = 1 < 2;</script></html>';
		const doc = explainerDocument(html);
		expect(doc).toContain("script-src 'unsafe-inline' https://unpkg.com/three@0.169.0/");
		expect(doc).toContain(html);
	});
});
