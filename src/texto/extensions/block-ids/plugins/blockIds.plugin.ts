import { Fragment } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { isHistoryTransaction } from "prosemirror-history";
import {
  AttrStep,
  ReplaceAroundStep,
  ReplaceStep,
} from "prosemirror-transform";

import { collectChangedRanges } from "../../../utils/changedRanges";
import { isBlockIdType } from "../blockIdAttrs";
import { generateBlockIdAvoiding } from "../generateBlockId";

export const blockIdsPluginKey = new PluginKey<null>("blockIds");

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
 * One pass over the changed ranges (document order):
 *  1. an addressable block without an id gets one (newly created blocks);
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
    appendTransaction(transactions, _oldState, newState) {
      const ranges = collectChangedRanges(transactions);
      if (ranges.length === 0) return null;

      const introducedIds = collectIntroducedIds(transactions);

      // Pass A — occurrences per id inside the ranges (document order).
      const occurrences = new Map<string, number>();
      let missing = 0;
      const docEnd = newState.doc.nodeSize;
      for (const range of ranges) {
        newState.doc.nodesBetween(
          range.from,
          Math.min(range.to, docEnd),
          (node) => {
            if (!isBlockIdType(node.type.name)) return true;
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
      // duplicates get fresh ones.
      const tr = newState.tr;
      const used = new Set<string>();
      const seenInRange = new Set<string>();
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
            const id = (node.attrs as IdAttrs).id;
            if (id == null) {
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
