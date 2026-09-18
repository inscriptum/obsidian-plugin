import { Plugin, PluginKey } from "prosemirror-state";
import type { JSONContent } from "../../core/@types";

/**
 * The note always ends with an empty paragraph.
 *
 * A text caret can only live inside a text block. When the last block is
 * anything else — a code block, a table, an image/attachment (atom), a
 * heading, a list — there is no place below it for the caret: on desktop
 * the editor draws a stub cursor and the arrows cannot leave the block, on
 * mobile the note becomes impossible to continue, and a click near a
 * trailing atom (image/attachment) even produces a NodeSelection, so the
 * next keystroke would replace it. Keeping a trailing paragraph makes the
 * end of every note reachable.
 *
 * The invariant is enforced in two places:
 * - `trailingParagraphPlugin` restores it after every transaction with a
 *   silent (addToHistory: false) transaction, so undo never removes nor
 *   replays it;
 * - `ensureTrailingParagraphJSON` normalizes the document at READ time,
 *   because the initial editor state is built without any transaction, so
 *   appendTransaction never sees the loaded document. The fix-up stays in
 *   memory until the user's next real edit — opening a note never writes.
 */

export const trailingParagraphPluginKey = new PluginKey("trailingParagraph");

export function trailingParagraphPlugin(): Plugin {
  return new Plugin({
    key: trailingParagraphPluginKey,
    appendTransaction: (transactions, _oldState, newState) => {
      // Only document edits may change the document. Selection-only
      // transactions (drag start, caret moves, fold guards) must stay
      // doc-neutral: other code builds transactions against the current
      // state snapshot, and a doc mutated out from under them breaks them
      // ("Applying a mismatched transaction" in the drag-handle flow).
      // A selection change can never make the doc end hostile anyway.
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const { doc, schema } = newState;
      const paragraphType = schema.nodes.paragraph;
      const last = doc.lastChild;

      if (
        paragraphType == null ||
        last == null ||
        last.type === paragraphType
      ) {
        return null;
      }

      const tr = newState.tr.insert(doc.content.size, paragraphType.create());
      // The trailing paragraph is a structural guarantee, not a user edit —
      // keeping it out of history means undo never removes it and never
      // replays it.
      tr.setMeta("addToHistory", false);
      return tr;
    },
  });
}

/** Append an empty paragraph when the note does not end with one (JSON
 *  level, used on read — see parseNoteDoc). Non-noteDoc input and documents
 *  already ending with a paragraph are returned untouched. */
export function ensureTrailingParagraphJSON(doc: JSONContent): JSONContent {
  if (doc?.type !== "noteDoc" || !Array.isArray(doc.content)) return doc;
  const content = doc.content;
  const last = content[content.length - 1];
  if (last != null && last.type !== "paragraph") {
    content.push({ type: "paragraph" });
  }
  return doc;
}
