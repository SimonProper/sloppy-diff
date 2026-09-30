/**
 * localStorage that never throws: private windows and blocked storage just don't
 * remember anything, and the page still works for this visit.
 */

export function readText(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** null removes the key */
export function writeText(key: string, value: string | null) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// not remembered, still works for this visit
	}
}

export function readJson<T>(key: string, fallback: T): T {
	const value = readText(key);
	if (value === null) return fallback;
	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
}

export function writeJson(key: string, value: unknown) {
	writeText(key, JSON.stringify(value));
}
