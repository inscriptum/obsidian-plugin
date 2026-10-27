import type { CommentThread } from "../../texto/extensions/comment/model";

/**
 * The comments store of a .um container: one JSONL entry (`comments.jsonl`,
 * one thread per line) among the archive entries. Old plugin versions carry
 * the entry verbatim (unknown-entry rule, spec 12); this editor reads and
 * rewrites it as a whole — the file write itself stays atomic via
 * umVault/writeUmFile (never remove-then-recreate, rule-open-file-safety).
 */

/** Archive entry name of the thread store. */
export const UM_COMMENTS_ENTRY = "comments.jsonl";

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

/** Is this a comment-shaped object? */
function isCommentEntry(value: unknown): value is CommentThread["comments"][number] {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<CommentThread["comments"][number]>;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.content === "string" &&
    typeof entry.createdAt === "number"
  );
}

/** Is this a thread-shaped object? The store tolerates junk lines: a line
 *  that does not parse or misses the required shape is skipped, never
 *  rejected — losing one bad line is better than losing the store. */
function isThread(value: unknown): value is CommentThread {
  if (typeof value !== "object" || value === null) return false;
  const thread = value as Partial<CommentThread>;
  return (
    typeof thread.id === "string" &&
    thread.id.length > 0 &&
    typeof thread.noteId === "string" &&
    thread.noteId.length > 0 &&
    typeof thread.resolved === "boolean" &&
    Array.isArray(thread.comments) &&
    thread.comments.every(isCommentEntry)
  );
}

/** Parse the JSONL bytes into threads. Duplicate ids keep the first
 *  occurrence. Never throws — a broken store reads as empty. */
export function parseThreads(bytes: Uint8Array): CommentThread[] {
  const text = TEXT_DECODER.decode(bytes);
  const out: CommentThread[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isThread(value) || seen.has(value.id)) continue;
    seen.add(value.id);
    out.push(value);
  }
  return out;
}

/** Serialize threads to JSONL bytes (deterministic field order: threads are
 *  written as given — the container's own ordering). */
export function serializeThreads(threads: CommentThread[]): Uint8Array {
  const text =
    threads.length === 0
      ? ""
      : threads.map((thread) => JSON.stringify(thread)).join("\n") + "\n";
  return TEXT_ENCODER.encode(text);
}
