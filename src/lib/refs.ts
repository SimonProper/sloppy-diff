export interface Branch {
	name: string;
	kind: 'local' | 'remote' | 'tag';
	sha: string;
	/** checked out */
	current: boolean;
	date: string;
	subject: string;
}

export interface Commit {
	sha: string;
	subject: string;
	author: string;
	date: string;
	/** branches and tags pointing at this commit */
	refs: string[];
	/** short shas of its parents, the first one is the line it was committed on */
	parents: string[];
}

/** One commit in full, for the commit view. */
export interface CommitInfo extends Omit<Commit, 'refs'> {
	/** the message after the subject line */
	body: string;
	/** full hashes, so the commit and its parent need no further lookups */
	hash: string;
	parentHashes: string[];
}

/** Whether two shas abbreviated to different lengths name the same commit. */
export function sameSha(a: string, b: string): boolean {
	return a === b || (a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a)));
}

const UNITS: [number, string][] = [
	[60, 's'],
	[60, 'm'],
	[24, 'h'],
	[7, 'd'],
	[4.35, 'w'],
	[12, 'mo'],
	[Infinity, 'y']
];

/** Compact relative time: 5m, 3h, 2d, 4mo. */
export function timeAgo(iso: string, now = Date.now()): string {
	let value = Math.max(0, (now - new Date(iso).getTime()) / 1000);
	for (const [size, unit] of UNITS) {
		if (value < size) return unit === 's' ? 'now' : `${Math.floor(value)}${unit}`;
		value /= size;
	}
	return '';
}
