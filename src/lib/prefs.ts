/** Remembers a view preference for a year, read back by the server on the next load. */
export function remember(name: string, value: string) {
	document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}
