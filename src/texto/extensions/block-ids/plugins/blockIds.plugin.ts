import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { isHistoryTransaction } from "prosemirror-history";
import {
  AttrStep,
  ReplaceAroundStep,
  ReplaceStep,
} from "prosemirror-transform";

import { collectChangedRanges } from "../../../utils/changedRanges";
import { isBlockIdType } from "../blockIdAttrs";
import { generateBlockIdAvoiding, isBlockId } from "../generateBlockId";

export const blockIdsPluginKey = new PluginKey<null>("blockIds");

/**
 * Meta flag on content-replacement transactions whose content comes from
 * OUTSIDE the editor (external sync, disk reload — the setContent callers
 * in NoteView). Copy detection is skipped for such batches: the incoming
 * ids are the document's own ids arriving from another device, not copies
 * — re-id'ing them would churn ids back and forth between devices forever.
 * Missing-id assignment still runs (a legacy document replaced wholesale
 * still gets tagged).
 */
export const BLOCK_IDS_EXTERNAL_CONTENT = "blockIdsExternalContent";

interface IdAttrs {
  id?: string | null;
}

/** Ids of every addressable block inside a fragment (recursive). */
function collectFragmentBlockIds(fragment: Fragment, out: Set<string>): void {
  fragment.descendants((node) => {
    if (!isBlockIdType(node.type.name)) return;
    const id = (node.attrs as IdAttrs).id;
    if (typeof id === "string") out.add(id);
  });
}

/**
 * Ids a transaction batch introduces as COPIES — ids arriving inside an
 * inserted slice that the batch did not also remove. Pasting or duplicating
 * content copies its ids along (PM node copies carry attrs), so those
 * blocks must be re-id'd (spec um-cli §4.5: copy/paste and duplicate give
 * the copy fresh ids). A move within the document deletes the source and
 * re-inserts the same ids — often in steps whose own slice is empty — so
 * removed content is collected across ALL replace steps, not just those
 * carrying an inserted slice; identical removed/inserted ids cancel out and
 * the move keeps its ids.
 *
 * Undo/redo restores prior ids verbatim and is excluded: history replays
 * the whole recorded event (including this plugin's own fix-ups), so both
 * undo and redo reproduce exactly the ids that existed before.
 *
 * Known deviation (spec §4.5 move rule): a CUT+paste (copy and delete in
 * two separate dispatches) re-ids the pasted block — the two halves of the
 * move never meet in one batch, so the ids cannot cancel. The document
 * stays unique and valid; a moved-by-cut block simply changes id. Also
 * indistinguishable from a move for this heuristic: copying a block and
 * editing the source inline within one batch (copy first in document
 * order) hands the source's id to the copy — unreachable through the
 * app's own commands, and the storage invariant (unique valid ids) holds
 * either way.
 */
function collectIntroducedIds(transactions: readonly Transaction[]): Set<string> {
  const inserted = new Set<string>();
  const removed = new Set<string>();

  for (const tr of transactions) {
    if (isHistoryTransaction(tr)) continue;

    for (let i = 0; i < tr.steps.length; i += 1) {
      const step = tr.steps[i];
      if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) {
        continue;
      }
      collectFragmentBlockIds(step.slice.content, inserted);

      const before = tr.docs[i];
      collectFragmentBlockIds(before.slice(step.from, step.to).content, removed);
    }
  }

  const introduced = new Set<string>();
  for (const id of inserted) {
    if (!removed.has(id)) introduced.add(id);
  }
  return introduced;
}

/**
 * The id the SAME node carried before this batch, when the batch replaced
 * the node's attrs wholesale (a partial setNodeMarkup: a code-block language
 * switch, an image src resync — those pass `{class}` / `{data, state}`
 * without spreading, and PM's setNodeMarkup REPLACES the whole attrs object,
 * filling the missing id with its default null). The node is recognized in
 * the pre-batch document by mapping its position back through the batch and
 * comparing type, content and marks — an equal-shaped node there is this
 * node with its pre-batch attrs, so its id must survive (spec §4.5: attr
 * edits keep ids). Nodes that are genuinely new (paste, split) map onto
 * different content and get a fresh id.
 */
function recoverPreBatchId(
  transactions: readonly Transaction[],
  oldDoc: ProseMirrorNode,
  node: ProseMirrorNode,
  pos: number,
): string | null {
  let oldPos = pos;
  for (let i = transactions.length - 1; i >= 0; i -= 1) {
    oldPos = transactions[i].mapping.invert().map(oldPos);
  }
  // Only a node the batch CONSUMED may donate its id: a partial
  // attrs-replace's step covers exactly the node's span. A node that merely
  // sits next to an insertion (same type/content by coincidence) must keep
  // its id to itself — recovering into an inserted neighbor would hand out
  // a duplicate until the save net runs.
  let consumed = false;
  let cur = oldPos;
  walk: for (const tr of transactions) {
    for (let i = 0; i < tr.steps.length; i += 1) {
      const step = tr.steps[i];
      if (
        (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) &&
        cur >= step.from &&
        cur + node.nodeSize <= step.to
      ) {
        consumed = true;
        break walk;
      }
      cur = tr.mapping.maps[i].map(cur, 1);
    }
  }
  if (!consumed) return null;

  const oldNode = oldDoc.nodeAt(oldPos);
  if (oldNode == null || oldNode.type !== node.type) return null;
  if (!oldNode.content.eq(node.content)) return null;
  if (oldNode.marks.length !== node.marks.length) return null;
  for (let i = 0; i < oldNode.marks.length; i += 1) {
    if (!oldNode.marks[i].eq(node.marks[i])) return null;
  }
  const oldId: unknown = oldNode.attrs.id;
  return isBlockId(oldId) ? oldId : null;
}

/**
 * One pass over the changed ranges (document order):
 *  1. an addressable block without an id gets one (newly created blocks) —
 *     unless it is the same node a partial attrs-replace stripped (see
 *     recoverPreBatchId), in which case its previous id comes back;
 *  2. a block carrying an id this batch introduced as a COPY gets a fresh
 *     one — unless the id occurs more than once inside the ranges, which is
 *     a split shape: the first occurrence keeps the original id (spec
 *     §4.5: split keeps it on the first/left part) and the rest are re-id'd;
 *  3. any other id seen twice inside the ranges is the same split shape.
 *
 * The occurrence map makes the rules order-independent and keeps the
 * common keystroke at one small walk that assigns nothing.
 */
export function createBlockIdsPlugin(): Plugin<null> {
  return new Plugin<null>({
    key: blockIdsPluginKey,
    appendTransaction(transactions, oldState, newState) {
      const ranges = collectChangedRanges(transactions);
      if (ranges.length === 0) return null;

      // External content swaps keep the arriving ids (CR-01): copy
      // detection is skipped, missing-id assignment still runs.
      const isExternalContent = transactions.some(
        (tr) => tr.getMeta(BLOCK_IDS_EXTERNAL_CONTENT) === true,
      );
      const introducedIds = isExternalContent
        ? new Set<string>()
        : collectIntroducedIds(transactions);

      // Pass A — occurrences per id inside the ranges (document order).
      // Ranges of one batch are frequently non-adjacent (a table column
      // resize updates one cell per row), and nodesBetween visits the
      // SHARED ANCESTOR (the table) once per range — count each NODE once,
      // by position, or an ancestor with a single id reads as a duplicate
      // of itself (review PR #19 CR-32).
      const occurrences = new Map<string, number>();
      const counted = new Set<number>();
      let missing = 0;
      const docEnd = newState.doc.nodeSize;
      for (const range of ranges) {
        newState.doc.nodesBetween(
          range.from,
          Math.min(range.to, docEnd),
          (node, pos) => {
            if (!isBlockIdType(node.type.name)) return true;
            if (counted.has(pos)) return true;
            counted.add(pos);
            const id = (node.attrs as IdAttrs).id;
            if (id == null) {
              missing += 1;
              return true;
            }
            occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
            return true;
          },
        );
      }

      if (missing === 0) {
        let needsFix = false;
        for (const [id, count] of occurrences) {
          if (count > 1 || introducedIds.has(id)) needsFix = true;
        }
        if (!needsFix) return null;
      }

      // Pass B — assign: first occurrence keeps its id, copies and later
      // duplicates get fresh ones. Same per-position dedupe as Pass A: a
      // shared ancestor visited by several ranges must be handled exactly
      // once.
      const tr = newState.tr;
      const used = new Set<string>();
      const seenInRange = new Set<string>();
      const handled = new Set<number>();
      let changed = false;

      const reId = (pos: number): void => {
        const id = generateBlockIdAvoiding(used);
        used.add(id);
        // AttrStep, not setNodeMarkup: an attribute update must not surface
        // as a content replace — setNodeMarkup's ReplaceStep flags positions
        // at the node's boundaries as deleted, which drops NodeSelections
        // anchored on the node and folds pointing at it (observed on the
        // drag-handle move). A step that cannot apply (a node vanished in
        // the same batch) is skipped, never crashing the editor.
        try {
          tr.step(new AttrStep(pos, "id", id));
          changed = true;
        } catch {
          // leave the node without an id; the save-time net may still fix it
        }
      };

      for (const range of ranges) {
        newState.doc.nodesBetween(
          range.from,
          Math.min(range.to, docEnd),
          (node, pos) => {
            if (!isBlockIdType(node.type.name)) return true;
            if (handled.has(pos)) return true;
            handled.add(pos);
            const id = (node.attrs as IdAttrs).id;
            if (id == null) {
              // A stripped attrs-replace keeps its previous id (CR-02);
              // a genuinely new node gets a fresh one.
              const recovered = recoverPreBatchId(transactions, oldState.doc, node, pos);
              if (recovered != null) {
                used.add(recovered);
                if (seenInRange.has(recovered)) {
                  reId(pos);
                  return true;
                }
                seenInRange.add(recovered);
                try {
                  tr.step(new AttrStep(pos, "id", recovered));
                  changed = true;
                } catch {
                  // leave it to the save-time net
                }
                return true;
              }
              reId(pos);
              return true;
            }
            const isFirst = !seenInRange.has(id);
            if (isFirst) seenInRange.add(id);
            const isCopy = introducedIds.has(id) && occurrences.get(id) === 1;
            if (!isFirst || isCopy) {
              reId(pos);
            }
            return true;
          },
        );
      }

      return changed ? tr : null;
    },
  });
}
