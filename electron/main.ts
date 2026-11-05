// The desktop app: the built SvelteKit server (`pnpm build`) run in a utility process of its
// own (server.ts), with a window on it. The page talks to it as it would in a browser.
// With --dev it's Vite's dev server instead, with hot reload, as `pnpm dev` runs it.
// TypeScript that Electron's Node runs as it is, its types stripped, so only types Node can
// erase: no enums, namespaces or parameter properties.
import { app, BrowserWindow, dialog, shell, utilityProcess, type UtilityProcess } from 'electron';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// fixed, the page keeps themes and prefs in localStorage, which is per port
const PORT = 47613;
const dev = process.argv.includes('--dev');

// a second launch focuses the first, the port is taken
if (!app.requestSingleInstanceLock()) app.exit();

process.env.PATH = loginPath();
// a packaged app runs in /, guides go where apps keep their data
if (app.isPackaged) process.env.GUIDES_DIR ??= join(app.getPath('userData'), 'guides');

/**
 * Opened from the Finder or Dock the app gets a bare PATH, without the git, claude,
 * codex, gh and clangd the shell finds, so it's asked for its own.
 */
function loginPath() {
	try {
		const shell = process.env.SHELL || '/bin/zsh';
		const out = execFileSync(shell, ['-ilc', 'printf "\\n%s\\n" "$PATH"'], {
			encoding: 'utf8',
			timeout: 5000
		});
		return out.trim().split('\n').pop() || process.env.PATH;
	} catch {
		return process.env.PATH;
	}
}

let server: UtilityProcess | undefined;

/**
 * Starts the server in a utility process and returns where it's listening. Not in this process:
 * input reaches the page through this one, and the server's work here, git spawned for each
 * status read, held keystrokes up.
 */
function serve(): Promise<string> {
	// adapter-node assumes https without it, and every POST would fail the origin checks
	if (!dev) process.env.ORIGIN = `http://127.0.0.1:${PORT}`;
	const child = utilityProcess.fork(join(import.meta.dirname, 'server.ts'), dev ? ['--dev'] : [], {
		// PATH, GUIDES_DIR and ORIGIN as set above
		env: process.env,
		// its log, git's and the agents', where the app was started from
		stdio: 'inherit',
		serviceName: 'sloppy-diff server'
	});
	server = child;
	return new Promise((resolve, reject) => {
		child.once('message', (message: { url?: string; error?: string }) =>
			message.url ? resolve(message.url) : reject(new Error(message.error))
		);
		child.once('exit', (code) => {
			reject(new Error(`The server stopped before it started, code ${code}`));
			// gone once the app was up: nothing works without it
			if (ORIGIN) {
				dialog.showErrorBox('sloppy-diff stopped', `Its server exited with code ${code}.`);
				app.quit();
			}
		});
	});
}

let window: BrowserWindow | undefined;
function open() {
	window = new BrowserWindow({
		width: 1440,
		height: 900,
		title: 'sloppy-diff',
		// the page's header is the title bar, the traffic lights centred in its 48px
		titleBarStyle: 'hiddenInset',
		trafficLightPosition: { x: 16, y: 17 }
	});
	window.loadURL(ORIGIN);
	// GitHub and the like open in the browser, not in another app window
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith(ORIGIN)) return { action: 'allow' };
		shell.openExternal(url);
		return { action: 'deny' };
	});
}

// empty until the server is up
let ORIGIN = '';
// not a top-level await: Electron holds back ready until the main module has run
app
	.whenReady()
	.then(async () => {
		// a packaged app has its own, from electron/icon.png
		if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, 'icon.png'));
		ORIGIN = await serve();
		open();
	})
	.catch((error) => {
		dialog.showErrorBox('sloppy-diff could not start', String(error?.stack ?? error));
		app.quit();
	});

app.on('second-instance', () => window?.focus());
// the Dock icon reopens the window, once the server is up
app.on('activate', () => !ORIGIN || BrowserWindow.getAllWindows().length || open());
app.on('window-all-closed', () => process.platform === 'darwin' || app.quit());
app.on('will-quit', () => server?.kill());
