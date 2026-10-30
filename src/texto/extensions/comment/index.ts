import { Extension } from "../../core";
import type { CommandsSet } from "../../core/@types";
import type { JSONContent } from "../../core/@types";
import { addCommands } from "./commands";
import { CommentMark } from "./comment-mark";
import { createCommentsPlugin } from "./comments-plugin";
import type { CommentHooks } from "./model";

export { CommentMark } from "./comment-mark";
export {
  commentsPluginKey,
  createCommentsPlugin,
  findCommentRanges,
  getCommentRanges,
  refreshComments,
  type CommentRange,
} from "./comments-plugin";
export type {
  CommentEntry,
  CommentHooks,
  CommentThread,
  CommentThreadMeta,
} from "./model";

/** Whether a stored document JSON carries a comment anchor of the thread
 *  (read-only walk — answers the panel's "anchor removed" state). */
export function jsonHasCommentMark(doc: JSONContent, threadId: string): boolean {
  let found = false;
  const walk = (node: JSONContent): void => {
    if (found) return;
    if (
      Array.isArray(node.marks) &&
      node.marks.some(
        (mark) =>
          mark.type === "comment" &&
          (mark.attrs as { id?: string } | undefined)?.id === threadId,
      )
    ) {
      found = true;
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };
  walk(doc);
  return found;
}

/** Strip every comment mark of one thread id from a stored document JSON,
 *  in place (thread deletion on a collapsed page — no editor exists to run
 *  the command). Returns whether anything changed. */
export function stripCommentMarkFromJson(
  doc: JSONContent,
  threadId: string,
): boolean {
  let changed = false;
  const walk = (node: JSONContent): void => {
    if (Array.isArray(node.marks) && node.marks.some((mark) => mark.type === "comment")) {
      const kept = node.marks.filter(
        (mark) =>
          !(
            mark.type === "comment" &&
            (mark.attrs as { id?: string } | undefined)?.id === threadId
          ),
      );
      if (kept.length !== node.marks.length) {
        changed = true;
        if (kept.length > 0) {
          node.marks = kept;
        } else {
          delete node.marks;
        }
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };
  walk(doc);
  return changed;
}

/**
 * The comments feature: anchor mark + decorations + commands. Thread data
 * lives outside the document (jsonl entry of the .um container) and reaches
 * the editor only through hooks — absent hooks keep the mark registered
 * (cross-generation documents must load) but render it inert.
 */
export interface CommentsOptions {
  hooks?: CommentHooks | null;
}

export const Comments = Extension.create<CommentsOptions>({
  name: "comments",

  addOptions() {
    // NOTE: deliberately no `hooks` key — mergeDeep() clones plain objects
    // key-by-key against the defaults and would strip the functions (the
    // same trap WikiLink/Image avoid by not declaring their hooks key).
    return {};
  },

  addExtensions() {
    return [CommentMark];
  },

  addCommands,

  addProseMirrorPlugins() {
    return [createCommentsPlugin(this.options.hooks ?? null)];
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
