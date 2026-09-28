import type { GuideSection, SectionKind } from './types';

export const KINDS: { kind: SectionKind; label: string }[] = [
	{ kind: 'core', label: 'Core' },
	{ kind: 'supporting', label: 'Supporting' },
	{ kind: 'chore', label: 'Chores' }
];

/** Sections in reading order: core first, whatever order they were written in. */
export function orderSections(sections: GuideSection[]): GuideSection[] {
	return KINDS.flatMap(({ kind }) => sections.filter((s) => s.kind === kind));
}
