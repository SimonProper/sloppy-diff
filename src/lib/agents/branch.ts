import { firstLine } from '$lib/markdown';

/** The branch a new worktree gets for what it's asked, as Intent names its workspaces. */
export function slugOf(text: string): string {
	return (
		firstLine(text)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40)
			.replace(/-+$/, '') || 'session'
	);
}
