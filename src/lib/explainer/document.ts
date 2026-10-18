/**
 * The explainer needs inline scripts and the template's pinned Three.js modules.
 * Everything else stays inside its opaque-origin, allow-scripts-only iframe.
 * Put the policy before any generated markup so it applies to the entire document.
 */
export function explainerDocument(html: string): string {
	const policy = [
		"default-src 'none'",
		"script-src 'unsafe-inline' https://unpkg.com/three@0.169.0/",
		"style-src 'unsafe-inline'",
		'img-src data: blob:',
		"connect-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-src 'none'"
	].join('; ');
	return `<!doctype html>\n<meta http-equiv="Content-Security-Policy" content="${policy}">\n${html.replace(/<!doctype[^>]*>/gi, '')}`;
}
