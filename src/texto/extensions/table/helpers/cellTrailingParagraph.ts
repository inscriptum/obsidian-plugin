import { Plugin, PluginKey } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";

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
 * The invariant is enforced after every document-changing transaction with
 * a silent (addToHistory: false) transaction, so undo never removes nor
 * replays the inserted paragraph. Documents read from disk cannot violate
 * it yet (the schema gained image-in-cell together with this plugin), so
 * no read-time JSON normalization is needed.
 */

export const cellTrailingParagraphKey = new PluginKey("cellTrailingParagraph");

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

      // Collect insertion positions (inside each offending cell, after its
      // last child). Applied in descending order so earlier positions stay
      // valid against the mutated transaction document.
      const insertions: number[] = [];
      doc.descendants((node, pos) => {
        if (
          cellTypes.includes(node.type) &&
          node.lastChild?.type === imageType
        ) {
          insertions.push(pos + node.nodeSize - 1);
        }
        return true;
      });

      if (insertions.length === 0) return null;

      let tr: Transaction | null = null;
      for (let i = insertions.length - 1; i >= 0; i -= 1) {
        (tr ??= newState.tr).insert(insertions[i], paragraphType.create());
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

/**
 * Read-time twin of the plugin above (JSON level, like
 * ensureTrailingParagraphJSON for the note end): appends an empty paragraph
 * to every table cell whose last block is an image. Documents produced by
 * this editor always satisfy the invariant (the plugin repairs before the
 * next save), but externally produced JSON — a hand-edited file, an import
 * — can carry a cell ending on an image; with no caret place below it the
 * next keystroke would REPLACE the image. Normalizing on read closes that
 * window before the editor ever shows the document.
 */
export function ensureCellTrailingParagraphJSON<T extends JsonNode>(doc: T): T {
  const cellTypes = new Set(["tableCell", "tableHeader"]);
  const walk = (node: JsonNode): void => {
    const content = node.content;
    if (!Array.isArray(content)) return;
    if (
      cellTypes.has(node.type ?? "") &&
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
