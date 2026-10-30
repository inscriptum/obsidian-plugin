import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";
import { findCommentRanges } from "./comments-plugin";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  // Both commands are ordinary history transactions. Undo therefore behaves
  // like the orphan policy dictates: undoing a setComment removes the mark
  // (a still-open composer then submits into an "Anchor removed" thread),
  // undoing a thread deletion resurrects an anchor whose thread is gone —
  // a highlight without a counter bubble, removable by clearing formatting.
  return {
    /** Mark the current text selection as a comment anchor (fresh id). */
    setComment:
      (attributes: { id: string }): Command =>
      ({ commands }) => {
        return commands.setMark("comment", { id: attributes.id });
      },
    /** Remove every anchor of one thread id from the document (thread
     *  deletion). Works across the whole doc, not just the selection. */
    unsetComment:
      (id: string): Command =>
      ({ tr, state, dispatch }) => {
        const ranges = findCommentRanges(state.doc).filter(
          (range) => range.id === id,
        );
        if (ranges.length === 0) return false;
        const markType = state.schema.marks.comment;
        if (!markType) return false;
        if (dispatch) {
          for (const range of ranges) {
            tr.removeMark(range.from, range.to, markType);
          }
          dispatch(tr);
        }
        return true;
      },
  };
}
