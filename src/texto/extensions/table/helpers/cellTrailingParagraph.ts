import { Plugin, PluginKey } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import type { Mapping } from "prosemirror-transform";

/**
 * Every table cell ends with a paragraph — the cell-level twin of the note
 * trailing paragraph (note-doc/trailingParagraph).
 *
 * Cells are isolated: when the last block of a cell is a cursor-hostile
 * atom (an image; attachment is not allowed in cells) there is no place
 * below it for the caret inside that cell. A click below the image produces
 * a NodeSelection and the next keystroke would replace the image — exactly
 * what the note-level invariant prevents at the document end.
 *
 * Enforcement is split in two:
 * - `cellTrailingParagraphPlugin` repairs at EDIT time, transaction-scoped:
 *   a violation can only be created by an edit inside the offending cell,
 *   so only cells intersecting the transaction's changed ranges are checked
 *   (a whole-document walk on every keystroke would cost O(doc) forever).
 *   The inserted paragraph is silent (addToHistory: false) — undo never
 *   removes nor replays it.
 * - `ensureCellTrailingParagraphJSON` repairs at READ time (JSON level),
 *   wired into parseNoteDoc (.note) and UmNotepad.prepareNote (.um pages):
 *   externally produced JSON — a hand-edited file, an import — can violate
 *   the invariant with no edit in sight, and must not reach the editor.
 */

export const cellTrailingParagraphKey = new PluginKey("cellTrailingParagraph");

/** Changed ranges of a transaction batch, in the final doc's coordinates:
 *  every step's replace range mapped through its own map (expanding over
 *  the inserted content) and through every later step's mapping. */
function changedRanges(
  transactions: readonly Transaction[],
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  const laterMaps: Mapping[] = [];
  for (let i = transactions.length - 1; i >= 0; i -= 1) {
    const tr = transactions[i];
    if (!tr.docChanged) continue;
    tr.steps.forEach((step, j) => {
      // tr.mapping.slice(j) starts with step j's own map: mapping the old
      // replace range through it yields the post-step range covering the
      // inserted content, then the remaining steps of this transaction.
      const rest = tr.mapping.slice(j);
      step.getMap().forEach((from, to) => {
        let f = rest.map(from, -1);
        let t = rest.map(to, 1);
        for (const map of laterMaps) {
          f = map.map(f, -1);
          t = map.map(t, 1);
        }
        ranges.push({ from: f, to: t });
      });
    });
    laterMaps.unshift(tr.mapping);
  }
  return ranges;
}

export function cellTrailingParagraphPlugin(): Plugin {
  return new Plugin({
    key: cellTrailingParagraphKey,
    appendTransaction: (transactions, _oldState, newState) => {
      // Only document edits may change the document (see the note-level
      // plugin): selection-only transactions must stay doc-neutral.
      if (!transactions.some((tr) => tr.docChanged)) return null;

      const { doc, schema } = newState;
      const cellTypes = [schema.nodes.tableCell, schema.nodes.tableHeader];
      const imageType = schema.nodes.image;
      const paragraphType = schema.nodes.paragraph;
      if (
        paragraphType == null ||
        imageType == null ||
        cellTypes.every((type) => type == null)
      ) {
        return null;
      }

      // Cells intersecting a changed range, each checked by its full last
      // child (the range may touch any part of the cell). Insertion goes
      // after the cell's last child; applied descending so earlier
      // positions stay valid against the mutated transaction document.
      const seen = new Set<number>();
      for (const range of changedRanges(transactions)) {
        const from = Math.max(0, range.from);
        const to = Math.min(doc.content.size, range.to);
        if (from > to) continue;
        doc.nodesBetween(from, to, (node, pos) => {
          if (
            cellTypes.includes(node.type) &&
            node.lastChild?.type === imageType
          ) {
            seen.add(pos + node.nodeSize - 1);
          }
          return true;
        });
      }

      if (seen.size === 0) return null;

      const insertions = Array.from(seen).sort((a, b) => b - a);
      let tr: Transaction | null = null;
      for (const pos of insertions) {
        (tr ??= newState.tr).insert(pos, paragraphType.create());
      }
      if (tr == null) return null;

      tr.setMeta("addToHistory", false);
      return tr;
    },
  });
}

type JsonNode = {
  type?: string;
  content?: JsonNode[] | undefined;
  [key: string]: unknown;
};

const JSON_CELL_TYPES = new Set(["tableCell", "tableHeader"]);

/** True when any table cell in the JSON document ends with an image node —
 *  the violation `ensureCellTrailingParagraphJSON` repairs. Pure check for
 *  callers that need to know whether the repair changed anything (the
 *  repair itself mutates in place). */
export function hasCellTrailingImage(doc: JsonNode | null): boolean {
  if (doc == null) return false;
  const content = doc.content;
  if (!Array.isArray(content)) return false;
  if (
    JSON_CELL_TYPES.has(doc.type ?? "") &&
    content[content.length - 1]?.type === "image"
  ) {
    return true;
  }
  for (const child of content) {
    if (child != null && hasCellTrailingImage(child)) return true;
  }
  return false;
}

/**
 * Read-time twin of the plugin above (JSON level, like
 * ensureTrailingParagraphJSON for the note end): appends an empty paragraph
 * to every table cell whose last block is an image. Documents produced by
 * this editor always satisfy the invariant (the edit-time plugin repairs
 * before the next save), but externally produced JSON — a hand-edited file,
 * an import — can carry a cell ending on an image; with no caret place
 * below it the next keystroke would REPLACE the image. Normalizing on read
 * closes that window before the editor ever shows the document.
 */
export function ensureCellTrailingParagraphJSON<T extends JsonNode>(doc: T): T {
  const walk = (node: JsonNode): void => {
    const content = node.content;
    if (!Array.isArray(content)) return;
    if (
      JSON_CELL_TYPES.has(node.type ?? "") &&
      content[content.length - 1]?.type === "image"
    ) {
      content.push({ type: "paragraph" });
    }
    for (const child of content) {
      if (child != null) walk(child);
    }
  };
  if (doc != null) walk(doc);
  return doc;
}
