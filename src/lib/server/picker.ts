import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Opens the operating system's own folder dialog and returns the chosen path,
 * or null when it was cancelled. Browsers never reveal real paths, but this
 * server runs on the same machine as the browser, so it can show the dialog
 * itself.
 */
export async function pickFolder(near?: string): Promise<string | null> {
	const start = startFolder(near);
	switch (process.platform) {
		case 'darwin':
			return pickMac(start);
		case 'linux':
			return pickLinux(start);
		default:
			throw new Error(`No native folder dialog on ${process.platform}, type the path instead`);
	}
}

/** The folder around the current repo, so its siblings are one click away. */
function startFolder(near?: string): string {
	for (const candidate of [near && dirname(near), near, homedir()]) {
		if (candidate && existsSync(candidate)) return candidate;
	}
	return homedir();
}

// the start folder travels as an argument, never spliced into the script
const script = (owner: string) => [
	'on run argv',
	`tell ${owner}`,
	'activate',
	'set chosen to choose folder with prompt "Choose a git repository" default location (POSIX file (item 1 of argv) as alias)',
	'end tell',
	'return POSIX path of chosen',
	'end run'
];

async function pickMac(start: string): Promise<string | null> {
	// asking the frontmost app (the browser) to show the dialog puts it in front
	// of the page, osascript on its own may open it behind the browser window
	const owners = ['application (path to frontmost application as text)', 'me'];
	for (const owner of owners) {
		try {
			const args = script(owner).flatMap((line) => ['-e', line]);
			const { stdout } = await exec('osascript', [...args, start]);
			return stdout.trim().replace(/\/$/, '') || null;
		} catch (error) {
			const stderr = String((error as { stderr?: string }).stderr ?? '');
			if (stderr.includes('-128')) return null; // cancelled
			// -1743: not allowed to control the browser, retry without it
			if (!stderr.includes('-1743') || owner === 'me')
				throw new Error(stderr.trim() || String(error));
		}
	}
	return null;
}

async function pickLinux(start: string): Promise<string | null> {
	const tools: [string, string[]][] = [
		[
			'zenity',
			['--file-selection', '--directory', `--filename=${start}/`, '--title=Choose a git repository']
		],
		['kdialog', ['--getexistingdirectory', start, '--title', 'Choose a git repository']]
	];
	for (const [tool, args] of tools) {
		try {
			const { stdout } = await exec(tool, args);
			return stdout.trim() || null;
		} catch (error) {
			const { code } = error as { code?: number | string };
			if (code === 'ENOENT') continue; // not installed, try the next one
			if (code === 1) return null; // cancelled
			throw error;
		}
	}
	throw new Error('Install zenity or kdialog for a native folder dialog, or type the path instead');
}
