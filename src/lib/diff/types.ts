export type LineKind = 'ctx' | 'add' | 'del';

export interface DiffLine {
	kind: LineKind;
	text: string;
	/** line number on the old side, null for additions */
	old: number | null;
	/** line number on the new side, null for deletions */
	new: number | null;
	/** the line is followed by "\ No newline at end of file" */
	noNewline?: boolean;
	/** highlighted markup, filled in on the server */
	html?: string;
	/** [start, end) columns of the pieces that are actually new, when a change engine ran */
	spans?: [number, number][];
	/** changed according to git but nothing in it is new: re-indented or re-wrapped */
	reformatted?: boolean;
}

export interface Hunk {
	/** stable across line shifts: derived from the path and the changed content */
	id: string;
	header: string;
	/** text after the closing @@, usually the enclosing function */
	section: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
}

/** How changes within lines are shown: whole lines, or down to the changed tokens. */
export type ChangeMode = 'lines' | 'tokens';

export interface FileChanges {
	/** nothing new, the file was only reformatted: re-indented, re-wrapped, respaced */
	formattingOnly: boolean;
}

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied';

export interface DiffFile {
	id: string;
	oldPath: string;
	newPath: string;
	status: FileStatus;
	binary: boolean;
	hunks: Hunk[];
	additions: number;
	deletions: number;
	language: string | null;
	changes?: FileChanges;
}
