import type { DiffFile } from './types';

export function splitPath(path: string): { dir: string; name: string } {
	const slash = path.lastIndexOf('/');
	return { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

export function displayPath(file: DiffFile): string {
	return file.status === 'deleted' ? file.oldPath : file.newPath;
}

const GENERATED =
	/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum)$/;

/** Lockfiles and similar noise start collapsed. */
export function isGenerated(file: DiffFile): boolean {
	return GENERATED.test(file.newPath);
}
