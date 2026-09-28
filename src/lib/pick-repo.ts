export type PickResult = { repo: string } | { cancelled: true } | { error: string };

/** Asks the server to show the native folder dialog, starting near `near`. */
export async function pickRepo(near?: string): Promise<PickResult> {
	try {
		const res = await fetch('/api/pick-repo', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ near })
		});
		const body = await res.json();
		return res.ok ? body : { error: body.message ?? 'Could not open the folder dialog' };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}
