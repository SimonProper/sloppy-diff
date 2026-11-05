import type { Item } from './types';

export type Step = Extract<Item, { type: 'tool' | 'thinking' }>;

/** A turn's items with each run of tool calls and thinking folded into one. */
export type Shown = Exclude<Item, Step> | { type: 'steps'; steps: Step[] };

export function foldSteps(items: Item[]): Shown[] {
	const out: Shown[] = [];
	for (const item of items) {
		if (item.type === 'thinking' && !item.text.trim()) continue;
		if (item.type !== 'tool' && item.type !== 'thinking') {
			out.push(item);
			continue;
		}
		const last = out.at(-1);
		if (last?.type === 'steps') last.steps.push(item);
		else out.push({ type: 'steps', steps: [item] });
	}
	return out;
}

const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Thought · read 6 files · ran 3 commands · edited 2 files" */
export function summarize(steps: Step[]): string {
	const tools = steps.filter((s) => s.type === 'tool');
	const named = (...names: string[]) => tools.filter((t) => names.includes(t.name));
	const files = (...names: string[]) => new Set(named(...names).map((t) => t.title)).size;
	const known = [
		'Read',
		'Edit',
		'Write',
		'Bash',
		'Grep',
		'Glob',
		'WebFetch',
		'WebSearch',
		'Agent',
		'Task',
		'TodoWrite'
	];
	const parts = [
		steps.some((s) => s.type === 'thinking') && 'thought',
		files('Read') && `read ${counted(files('Read'), 'file')}`,
		named('Bash').length && `ran ${counted(named('Bash').length, 'command')}`,
		files('Edit', 'Write') && `edited ${counted(files('Edit', 'Write'), 'file')}`,
		named('Grep', 'Glob').length && counted(named('Grep', 'Glob').length, 'search', 'searches'),
		named('WebFetch', 'WebSearch').length &&
			counted(named('WebFetch', 'WebSearch').length, 'web lookup'),
		named('Agent', 'Task').length && counted(named('Agent', 'Task').length, 'agent'),
		named('TodoWrite').length && 'updated the todos',
		tools.filter((t) => !known.includes(t.name)).length &&
			counted(tools.filter((t) => !known.includes(t.name)).length, 'other step')
	].filter(Boolean) as string[];
	const text = parts.join(' · ');
	return text[0].toUpperCase() + text.slice(1);
}
