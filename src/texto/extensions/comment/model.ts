/**
 * Thread data model for comments (owner decisions ОВ-1…ОВ-4, issue comments):
 * the anchor is a `comment` mark carrying a thread id; the thread data itself
 * lives OUTSIDE the document — one JSONL line per thread inside the .um
 * container. The types live here (editor side) so src/texto never imports
 * the storage layer; the storage (src/storage/um/umComments.ts) re-uses them.
 *
 * V1 is single-user: every comment is by the same author, threads are not
 * synchronized anywhere (no collab provider — the jsonl entry plays the
 * provider's role).
 */

/** One comment inside a thread. */
export interface CommentEntry {
  id: string;
  author: string;
  content: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms, present after an edit. */
  updatedAt?: number;
}

/** A comment thread: the anchor (mark) references it by `id`. */
export interface CommentThread {
  id: string;
  /** Notepad page the thread belongs to (created on). */
  noteId: string;
  resolved: boolean;
  /** Epoch ms, present once resolved; kept after unresolve for the banner. */
  resolvedAt?: number;
  comments: CommentEntry[];
}

/** What the editor needs to know about a thread to render its anchor. */
export interface CommentThreadMeta {
  id: string;
  commentCount: number;
  resolved: boolean;
}

/**
 * Vault/host hooks injected through ExtensionHooks — src/texto stays
 * Obsidian-free (same pattern as hooks.wiki / hooks.image). Absent hooks
 * switch the feature off: the mark still registers (documents written by a
 * commenting generation must load everywhere, rendered inert) but no
 * decorations are built and the commands no-op.
 */
export interface CommentHooks {
  /** Thread meta for an anchor id (any page of the notepad). */
  findThread(id: string): CommentThreadMeta | null;
  /** Anchor / counter-bubble click: the host opens the panel on this thread. */
  openThread(id: string): void;
}
