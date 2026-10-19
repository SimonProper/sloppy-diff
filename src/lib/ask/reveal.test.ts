import { describe, expect, test } from 'vitest';
import { advance, blocks, startReveal, stableLength, type Reveal } from './reveal';

const FRAME = 1000 / 60;
const prose = (words: number) =>
	Array.from({ length: words }, (_, i) => `word${i}`).join(' ') + ' ';

/** Frames of the reveal over `text`, until it's idle or `frames` ran out. */
function run(r: Reveal, text: string, streaming: boolean, frames: number): Reveal[] {
	const seen = [];
	for (let i = 0; i < frames && !(i > 0 && r.idle); i++) {
		r = advance(r, text, streaming, FRAME);
		seen.push(r);
	}
	return seen;
}

describe('pacing', () => {
	test('a large burst shows a little at a time, at no more than the ceiling', () => {
		const text = prose(2000);
		const frames = run(startReveal('', false), text, true, 60);
		expect(frames[0].shown).toBeLessThan(20);
		for (let i = 1; i < frames.length; i++) {
			expect(frames[i].shown - frames[i - 1].shown).toBeLessThanOrEqual(30);
		}
		// a second in, it has sped up toward the ceiling, but not past it
		const second = frames.at(-1)!;
		expect(second.rate).toBeGreaterThan(300);
		expect(second.rate).toBeLessThanOrEqual(900);
		expect(second.shown).toBeLessThan(900);
	});

	test('a slow stream shows at a reading pace and goes idle when caught up', () => {
		const text = prose(5);
		const frames = run(startReveal('', false), text, true, 200);
		expect(frames.at(-1)).toMatchObject({ shown: text.length, idle: true });
		expect(frames.length).toBeGreaterThan(10);
	});

	test('stops after whole words only', () => {
		const text = 'The quick brown fox jumps over the lazy dog and keeps going';
		for (const r of run(startReveal('', false), text, true, 200)) {
			expect(r.shown === 0 || /\s/.test(text[r.shown - 1])).toBe(true);
		}
		// "going" may go on, it waits
		expect(stableLength(text)).toBe(text.indexOf('going'));
	});

	test('once the stream ends, the backlog shows in well under a second', () => {
		const text = prose(1500);
		let r = advance(startReveal('', false), text, true, FRAME);
		const frames = run(r, text, false, 60);
		r = frames.at(-1)!;
		expect(r).toMatchObject({ shown: text.length, idle: true });
		expect(frames.length * FRAME).toBeLessThan(400);
	});

	test('a source that shrinks starts over', () => {
		let r = run(startReveal('', false), prose(20), true, 30).at(-1)!;
		expect(r.shown).toBeGreaterThan(0);
		r = advance(r, '', true, FRAME);
		expect(r.shown).toBe(0);
		r = run(r, 'Another try ', true, 100).at(-1)!;
		expect(r.shown).toBe('Another try '.length);
	});

	test('a saved answer that differs from what streamed shows whole, not typed again', () => {
		const r = run(startReveal('', false), 'Streamed text here ', true, 100).at(-1)!;
		expect(advance(r, 'Saved text, different', false, FRAME).shown).toBe(21);
	});

	test('an answer loaded with the thread shows at once', () => {
		const text = prose(500);
		expect(startReveal(text, true)).toMatchObject({ shown: text.length, idle: true });
	});

	test('reduced motion shows all that is stable at once', () => {
		const text = 'All of this shows **but not this';
		expect(advance(startReveal('', false), text, true, FRAME, true)).toMatchObject({
			shown: 'All of this shows '.length,
			idle: true
		});
	});
});

describe('stableLength holds back what is unfinished', () => {
	const held = (text: string) => text.slice(0, stableLength(text));

	test('unclosed bold, italic and strikethrough', () => {
		expect(held('Some **bold te')).toBe('Some ');
		expect(held('Some **bold** and *ital ')).toBe('Some **bold** and ');
		expect(held('Gone ~~old way ')).toBe('Gone ');
		expect(held('Done **bold** here ')).toBe('Done **bold** here ');
		// not marks
		expect(held('a snake_case name and 2 * 3 ')).toBe('a snake_case name and 2 * 3 ');
	});

	test('unclosed inline code, its contents literal', () => {
		expect(held('Run `npm i ')).toBe('Run ');
		expect(held('Run `a ** b` now ')).toBe('Run `a ** b` now ');
		expect(held('Use ``a ` b`` or ')).toBe('Use ``a ` b`` or ');
	});

	test('links without their target', () => {
		expect(held('See [the docs](https://exa')).toBe('See ');
		expect(held('See [the docs ')).toBe('See ');
		expect(held('See [the docs](https://x.dev) now ')).toBe('See [the docs](https://x.dev) now ');
		expect(held('An [aside] in brackets ')).toBe('An [aside] in brackets ');
	});

	test('code fences show whole lines, the opening line once complete', () => {
		expect(held('Code:\n``')).toBe('Code:\n');
		expect(held('Code:\n```ts')).toBe('Code:\n');
		expect(held('Code:\n```ts\nconst a = **1;\nconst b')).toBe('Code:\n```ts\nconst a = **1;\n');
		expect(held('```\nx\n```\nAfter it ')).toBe('```\nx\n```\nAfter it ');
	});

	test('tables row by row, after the header and separator', () => {
		expect(held('Intro\n\n| a | b ')).toBe('Intro\n\n');
		expect(held('Intro\n\n| a | b |\n')).toBe('Intro\n\n');
		expect(held('Intro\n\n| a | b |\n|---|-')).toBe('Intro\n\n');
		const table = '| a | b |\n|---|---|\n| 1 | 2 |\n';
		expect(held(table)).toBe(table);
		expect(held(`${table}| 3 | `)).toBe(table);
		// a pipe in prose holds only until the next line shows it isn't a table
		expect(held('a | b\nmore words ')).toBe('a | b\nmore words ');
	});

	test('a marker without its text, a rule or underline on its way', () => {
		expect(held('List:\n\n- ')).toBe('List:\n\n');
		expect(held('Title\n--')).toBe('Title\n');
		expect(held('Steps\n\n1.')).toBe('Steps\n\n');
	});

	test('marks only count in the block they are in', () => {
		expect(held('A stray * star\n\nNext **para ')).toBe('A stray * star\n\nNext ');
		expect(held('Stray **bold\n\nNext para ')).toBe('Stray **bold\n\nNext para ');
		expect(held('- one **x\n- two ')).toBe('- one **x\n- two ');
	});
});

test('blocks split the answer at the top level, finished ones stay as they were', () => {
	const text = 'Para one\nstill one\n\n- a\n- b\n\n```js\nx\n```\n\n| h |\n|---|\n| 1 |';
	const split = blocks(text);
	expect(split).toEqual([
		'Para one\nstill one',
		'- a\n- b',
		'```js\nx\n```',
		'| h |\n|---|\n| 1 |'
	]);
	expect(blocks(`${text}\n| 2 |\n\nMore`).slice(0, 3)).toEqual(split.slice(0, 3));
});
