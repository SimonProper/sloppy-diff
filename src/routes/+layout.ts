// A local tool: the server only loads data (git, diffs, guides) and the
// browser renders everything, so the diff isn't sent once as HTML and again as data.
export const ssr = false;
