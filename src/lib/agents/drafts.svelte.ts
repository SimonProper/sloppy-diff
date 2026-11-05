/**
 * What's typed in each session's field and not sent yet, by session, so it's still there after
 * going to another session and back. The page's own, a reload starts over.
 */
export const drafts = $state<Record<string, string>>({});
