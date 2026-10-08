/**
 * A comment's sanitized HTML as plain text to glance at: media named, not shown. Only the
 * entities sanitize-html and the highlighter write are in it.
 */
export const glance = (html: string): string =>
	html
		.replace(/<img\b[^>]*>/gi, ' [image] ')
		.replace(/<video\b[\s\S]*?<\/video>/gi, ' [video] ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
