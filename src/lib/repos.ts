export interface FoundRepo {
	path: string;
	name: string;
	/** checked out branch, null when detached */
	branch: string | null;
	/** last time git touched it: commits, checkouts, fetches, staging */
	active: string | null;
	/** origin's url, when there is one */
	remote: string | null;
}

export interface Scan {
	/** the home folder, so paths can be shown as ~/… */
	home: string;
	roots: string[];
	repos: FoundRepo[];
	scannedAt: string;
	ms: number;
	folders: number;
	/** the time or folder budget ran out before the walk finished */
	truncated: boolean;
}
