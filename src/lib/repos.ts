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

let scan: Promise<Scan> | undefined;

/** The repos found on this machine, fetched once per page load unless refreshed. */
export function loadRepos(refresh = false): Promise<Scan> {
	if (!scan || refresh) {
		scan = fetch(`/api/repos${refresh ? '?refresh' : ''}`).then((res) => {
			if (!res.ok) throw new Error('Could not scan for repositories');
			return res.json();
		});
		scan.catch(() => (scan = undefined));
	}
	return scan;
}
