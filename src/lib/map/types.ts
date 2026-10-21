/** The change as a map, see changeMap. */

export type NodeStatus = 'added' | 'modified' | 'removed' | 'affected';

export interface MapNode {
	/** `path:line:character`, where its name is, 0-based */
	id: string;
	name: string;
	kind: string;
	path: string;
	/** 1-based, where its name is */
	line: number;
	/** 0-based, where its name starts on the line */
	char: number;
	status: NodeStatus;
	/** the hunks in it, in diff order */
	hunks: string[];
	/** it's in a file the change adds */
	newFile?: true;
	/** the declaration it's a member of, shown in it once that's opened */
	parent?: string;
	/** it has members to open it into */
	members?: true;
	/** the change touches its outside, what its users see: its parameters, type or props */
	signature?: true;
	/** the lines the change wrote in it, and took away, when it touches it */
	plus?: number;
	minus?: number;
}

/** How one declaration uses another, read off the line the use is on. */
export type UseKind = 'call' | 'render' | 'prop' | 'type' | 'write' | 'read' | 'import';

/** `from` uses `to` */
export interface MapEdge {
	from: string;
	to: string;
	/** how many uses */
	count: number;
	/** one of the uses is on a line the change added */
	added: boolean;
	use: UseKind;
	/** the first use's line, trimmed */
	sample: string;
	/** where in `from`'s file the first use is, 1-based, for its uses to be read in that order */
	at?: number;
	/** the language server's error where `from` uses `to`, when it no longer type-checks */
	broken?: string;
}

export interface ChangeMap {
	nodes: MapNode[];
	edges: MapEdge[];
	/** what couldn't be read, for the reader */
	notes: string[];
}

/** What more can be asked about a node: who uses it, what it uses, what's in it. */
export type Way = 'users' | 'uses' | 'members';

/** A node as it's asked about again. */
export type NodeRef = Pick<MapNode, 'id' | 'path' | 'line' | 'char' | 'kind'>;
