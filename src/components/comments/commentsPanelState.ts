import type { CommentThread } from "../../texto/extensions/comment";

/** Sidebar segment filter: Open / Resolved. */
export type CommentsFilter = "open" | "resolved";

/** What the panel renders for one thread: the thread plus everything the
 *  view resolved for it (anchor presence for the orphan badge, page title). */
export interface ThreadViewModel {
  thread: CommentThread;
  /** False → the anchor text is gone from the page ("anchor removed",
   *  orphan policy: the thread stays until deleted manually). */
  hasAnchor: boolean;
  noteTitle: string;
}

/** View models for the panel. `anchorPresence` and the title map come from
 *  the view — the panel itself stays editor-free. */
export function buildThreadViewModels(
  threads: CommentThread[],
  noteTitles: Map<string, string>,
  anchorPresence: (thread: CommentThread) => boolean,
): ThreadViewModel[] {
  return threads.map((thread) => ({
    thread,
    hasAnchor: anchorPresence(thread),
    noteTitle: noteTitles.get(thread.noteId) ?? "",
  }));
}

/** Newest comment touch (creation or edit) — the Open list sorts by it. */
export function lastActivityAt(thread: CommentThread): number {
  return thread.comments.reduce(
    (max, comment) => Math.max(max, comment.updatedAt ?? comment.createdAt),
    0,
  );
}

/** The segment's threads, newest activity (Open) / resolution (Resolved)
 *  first. Pure — returns a fresh array. */
export function filterThreads(
  items: ThreadViewModel[],
  filter: CommentsFilter,
): ThreadViewModel[] {
  const matching = items.filter((item) =>
    filter === "open" ? !item.thread.resolved : item.thread.resolved,
  );
  return matching.sort((a, b) =>
    filter === "open"
      ? lastActivityAt(b.thread) - lastActivityAt(a.thread)
      : (b.thread.resolvedAt ?? 0) - (a.thread.resolvedAt ?? 0),
  );
}
