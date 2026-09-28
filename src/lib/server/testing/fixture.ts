import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseDiff } from '$lib/diff/parse';
import type { ChangeMode, DiffFile, DiffLine } from '$lib/diff/types';
import { annotateChanges } from '../changes';
import { readDiff } from '../git';
import { highlightFile } from '../highlight';

/**
 * A throwaway repo with one commit on `main` and one on `change`, where every
 * file exercises one thing the change modes should tell apart.
 */
export const BEFORE: Record<string, string> = {
	// a rename (qty -> quantity) plus a function that moves to the top
	'src/cart.ts': `import { formatPrice } from './format';

export interface Item {
	id: string;
	price: number;
	qty: number;
}

export function subtotal(items: Item[]): number {
	return items.reduce((total, item) => total + item.price * item.qty, 0);
}

export function describe(items: Item[]) {
	return \`\${items.length} items, \${formatPrice(subtotal(items))}\`;
}
`,
	// only re-wrapped, nothing new
	'src/format.ts': 'export const formatPrice = (n: number) => `$${n.toFixed(2)}`;\n',
	// multi-byte characters before the change, so columns must count characters
	'src/label.ts': 'export const label = "café — crème"; export const count = 1;\n',
	// plain text without a grammar, compared word by word
	'NOTES.txt': 'Release notes\nAdded discounts to the cart.\n',
	// a function that moves from the top of the file to the bottom
	'src/util.ts':
		'export function clamp(value: number, min: number, max: number) {\n\treturn Math.min(Math.max(value, min), max);\n}\n\nexport const A = 1;\nexport const B = 2;\nexport const C = 3;\nexport const D = 4;\nexport const E = 5;\nexport const F = 6;\nexport const G = 7;\nexport const H = 8;\n',
	// a function that moves to another file
	'src/helpers.ts':
		'export function double(value: number) {\n\treturn value * 2;\n}\n\nexport const ONE = 1;\n'
};

export const AFTER: Record<string, string> = {
	'src/cart.ts': `import { formatPrice } from './format';

export function describe(items: Item[]) {
	return \`\${items.length} items, \${formatPrice(subtotal(items))}\`;
}

export interface Item {
	id: string;
	price: number;
	quantity: number;
}

export function subtotal(items: Item[]): number {
	return items.reduce((total, item) => total + item.price * item.quantity, 0);
}
`,
	'src/format.ts': 'export const formatPrice = (n: number) =>\n\t`$${n.toFixed(2)}`;\n',
	'src/label.ts': 'export const label = "café — crème"; export const count = 2;\n',
	'NOTES.txt': 'Release notes (draft)\nAdded line item discounts to the cart.\n',
	'src/util.ts':
		'export const A = 1;\nexport const B = 2;\nexport const C = 3;\nexport const D = 4;\nexport const E = 5;\nexport const F = 6;\nexport const G = 7;\nexport const H = 8;\n\nexport function clamp(value: number, min: number, max: number) {\n\treturn Math.min(Math.max(value, min), max);\n}\n',
	'src/helpers.ts': 'export const ONE = 1;\n',
	'src/math.ts': 'export function double(value: number) {\n\treturn value * 2;\n}\n'
};

/** What each fixture file is there to show, in display order. */
export const ABOUT: { path: string; about: string }[] = [
	{
		path: 'src/cart.ts',
		about: 'Renames qty to quantity and moves describe() to the top of the file.'
	},
	{ path: 'src/format.ts', about: 'Re-wraps one line over two. Nothing in it is new.' },
	{
		path: 'src/label.ts',
		about: 'Changes 1 to 2 after "café — crème", so columns have to count characters.'
	},
	{ path: 'NOTES.txt', about: 'Plain text without a grammar, compared word by word.' },
	{ path: 'src/util.ts', about: 'Moves clamp() from the top of the file to the bottom.' },
	{ path: 'src/helpers.ts', about: 'Moves double() out of this file into src/math.ts.' },
	{ path: 'src/math.ts', about: 'New file that receives double() from src/helpers.ts.' }
];

export interface Fixture {
	root: string;
	/** diff main..change through the real pipeline in one mode */
	run: (mode: ChangeMode, to?: string) => Promise<Result>;
	/** write a file in the working tree */
	write: (path: string, content: string) => void;
	/** commit everything in the working tree on the current branch */
	commit: (message: string) => void;
	cleanup: () => void;
}

export interface Result {
	files: DiffFile[];
	summary: ReturnType<typeof annotateChanges>;
	file: (path: string) => DiffFile;
	/** the changed line of `kind` in `path` whose text contains `text` */
	line: (path: string, kind: 'add' | 'del', text: string) => DiffLine;
}

/** git without the user's global or system config. */
export const ISOLATED = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

export function createFixture(): Fixture {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'sloppy-diff-smoke-')));
	const git = (...args: string[]) =>
		execFileSync(
			'git',
			[
				'-c',
				'user.name=smoke',
				'-c',
				'user.email=smoke@test',
				'-c',
				'commit.gpgsign=false',
				...args
			],
			// the developer's hooks, signing or init templates mustn't get in the way,
			// the smoke page runs this inside the dev server
			{ cwd: root, stdio: 'pipe', env: { ...process.env, ...ISOLATED } }
		);
	const write = (path: string, content: string) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	};

	try {
		git('init', '-q', '-b', 'main');
		Object.entries(BEFORE).forEach(([path, content]) => write(path, content));
		git('add', '-A');
		git('commit', '-q', '-m', 'before');
		git('checkout', '-q', '-b', 'change');
		Object.entries(AFTER).forEach(([path, content]) => write(path, content));
		git('add', '-A');
		git('commit', '-q', '-m', 'after');
	} catch (error) {
		// a failed setup leaves no temp folder behind
		rmSync(root, { recursive: true, force: true });
		throw error;
	}

	return {
		root,
		write,
		commit: (message) => {
			git('add', '-A');
			git('commit', '-q', '-m', message);
		},
		cleanup: () => rmSync(root, { recursive: true, force: true }),
		async run(mode, to = 'change') {
			const files = parseDiff(await readDiff(root, 'main', to));
			const summary = annotateChanges(files, mode);
			files.forEach(highlightFile);

			const file = (path: string) => {
				const found = files.find((f) => f.newPath === path);
				if (!found) throw new Error(`${path} is not in the diff`);
				return found;
			};
			const line = (path: string, kind: 'add' | 'del', text: string) => {
				const found = file(path)
					.hunks.flatMap((h) => h.lines)
					.find((l) => l.kind === kind && l.text.includes(text));
				if (!found) throw new Error(`no ${kind} line containing "${text}" in ${path}`);
				return found;
			};
			return { files, summary, file, line };
		}
	};
}

/** The text of each highlighted piece of a line. */
export function novel(line: DiffLine): string[] {
	return (line.spans ?? []).map(([start, end]) => line.text.slice(start, end));
}
