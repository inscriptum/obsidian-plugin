import { Extension } from "../../core";

/** Block node types across all editor profiles that carry a block id —
 *  every block node of the schema (owner decision, issue block-ids ОВ-3).
 *  Global attributes on names absent from a profile are ignored, so one
 *  static list serves the note, title and plain families. */
export const BLOCK_ID_TYPES = [
  "paragraph",
  "heading",
  "noteTitle",
  "noteProperty",
  "notePropertyName",
  "notePropertyValue",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "hljsCodeBlock",
  "hljsCodeBlockRow",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "horizontalRule",
  "image",
  "attachment",
  "mermaid",
];

const BLOCK_ID_TYPE_SET = new Set<string>(BLOCK_ID_TYPES);

export function isBlockIdType(typeName: string): boolean {
  return BLOCK_ID_TYPE_SET.has(typeName);
}

export interface BlockIdGlobalAttribute {
  default: null;
  renderHTML: (attributes: { id?: string | null }) => object;
  parseHTML: (element: HTMLElement) => string | null;
}

/** The attrs.id declaration shared by the editor extension and the export
 *  schema. The canonical storage is attrs.id; the DOM projection is
 *  data-id (element ids are taken by anchors/TOC). */
export function blockIdAttribute(): {
  types: string[];
  attributes: { id: BlockIdGlobalAttribute };
} {
  return {
    types: BLOCK_ID_TYPES,
    attributes: {
      id: {
        default: null,
        renderHTML: (attributes: { id?: string | null }) =>
          attributes.id == null ? {} : { "data-id": String(attributes.id) },
        parseHTML: (element) => element.getAttribute("data-id"),
      },
    },
  };
}

/** Attr-only piece: declares attrs.id on every addressable block type. The
 *  export schema composes this one (it builds no editor, so it needs no
 *  plugin) — without it Node.fromJSON would silently drop stored ids. */
export const BlockIdAttributes = new Extension({
  name: "blockIdAttributes",
  addGlobalAttributes() {
    return [blockIdAttribute()];
  },
});
