export type SectionKind = 'core' | 'supporting' | 'chore';

export interface GuideNote {
	hunk: string;
	text: string;
}

export interface GuideSection {
	id: string;
	title: string;
	kind: SectionKind;
	/** markdown: why this part of the change exists */
	rationale: string;
	/** short shas of the commits that contributed */
	commits: string[];
	/** hunk ids, in reading order */
	hunks: string[];
	notes: GuideNote[];
	/** its hunks differ from when the guide was written, filled in when it's loaded */
	changed?: boolean;
	/** rendered rationale, filled in when the guide is loaded */
	html?: string;
}

/** What Claude produces, see GUIDE_SCHEMA. */
export interface GuideDraft {
	title: string;
	summary: string;
	sections: Omit<GuideSection, 'id' | 'html'>[];
}

export interface Guide extends Omit<GuideDraft, 'sections'> {
	version: 1;
	repo: string;
	start: string;
	stop: string;
	createdAt: string;
	model: string;
	sections: GuideSection[];
	/** written for an earlier version of the branch, found through its reflog */
	earlier?: boolean;
	/** how many of its steps lost hunks since, filled in when it's loaded */
	changed?: number;
	/** rendered summary, filled in when the guide is loaded */
	summaryHtml?: string;
}

export interface GuideListing {
	repo: string;
	title: string;
	start: string;
	stop: string;
	createdAt: string;
	sections: number;
}

/** What happens while a guide is generated, folded into a GuideProgress for the page. */
export type GuideEvent =
	| { type: 'status'; text: string }
	| { type: 'tool'; text: string }
	| { type: 'done'; start: string; stop: string }
	| { type: 'error'; message: string };
