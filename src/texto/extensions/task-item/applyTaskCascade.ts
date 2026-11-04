import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";

/**
 * EXPERIMENTAL dependent sub-tasks cascade (owner setting, default off):
 * checking a task checks every task item inside its subtree; unchecking
 * any task unchecks its whole parent chain — so a manually unchecked
 * sub-task unhangs its parent's checkmark (the owner's spec for the
 * dependent mode). With the setting off this is a no-op: every checkbox
 * toggles alone.
 *
 * All targets are resolved off the transaction's CURRENT doc: the caller
 * has already flipped the clicked item itself, and attr-only steps never
 * shift positions, so positions collected along the walk stay valid.
 *
 * The parent chain is resolved from INSIDE the flipped item
 * (position + 1): the resolved path then runs doc → … → every ancestor
 * task list and item → this item, and one ascending walk covers chains
 * of any depth. Depth 0 is skipped — it is the doc, and there is no
 * position before it.
 */
export function applyTaskCascade(
  tr: Transaction,
  position: number,
  checked: boolean,
  flippedNode: ProseMirrorNode | null,
  itemType: ProseMirrorNode["type"],
  dependent: boolean,
): void {
  if (!dependent || flippedNode == null) return;

  if (checked) {
    // CHECK: every task item inside the flipped item's subtree follows.
    const end = position + flippedNode.nodeSize;
    tr.doc.descendants((child, childPos) => {
      if (child.type === itemType && childPos > position && childPos < end) {
        tr.setNodeMarkup(childPos, undefined, { ...child.attrs, checked: true });
      }
      // do not descend past this item's subtree
      return childPos < end;
    });
    return;
  }

  // UNCHECK: the whole parent chain of the flipped item goes off. The
  // item itself is skipped by its position (it was just unchecked).
  const $inside = tr.doc.resolve(position + 1);
  // depth 0 is the doc — there is no position before it; task items
  // start at depth 1.
  for (let depth = 1; depth <= $inside.depth; depth += 1) {
    if ($inside.before(depth) === position) continue;
    const ancestor = $inside.node(depth);
    if (ancestor.type === itemType) {
      tr.setNodeMarkup($inside.before(depth), undefined, {
        ...ancestor.attrs,
        checked: false,
      });
    }
  }
}
