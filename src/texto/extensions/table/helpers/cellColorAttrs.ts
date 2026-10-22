/**
 * Read-time repair for table cell color attributes (JSON level, same layer
 * as ensureCellTrailingParagraphJSON).
 *
 * tableCell/tableHeader parseHTML used to emit `dataColor: []` (an array)
 * for every cell parsed from clipboard HTML. Cells inserted from a paste
 * carried that array into saved documents, and the color rendering
 * (safeColorValue → .trim) crashed the editor on the next open of the note.
 * The render side now guards on the type (safeColorValue, renderHTML), and
 * this repair strips the broken values from already-saved files on read —
 * the next autosave persists the normalized document.
 */

type JsonNode = { type?: string; attrs?: Record<string, unknown>; content?: JsonNode[] };

const CELL_TYPES = new Set(["tableCell", "tableHeader"]);

function colorAttrIsBroken(value: unknown): boolean {
  return value != null && typeof value !== "string";
}

/** True when any table cell carries a non-string color attr — the quirk
 *  `normalizeCellColorAttrsJSON` repairs. Pure check for callers that need
 *  to know whether the repair changed anything (the repair mutates in
 *  place), mirroring hasCellTrailingImage. */
export function hasCellColorAttrQuirk(doc: JsonNode | null): boolean {
  if (doc == null) return false;
  const content = doc.content;
  if (!Array.isArray(content)) return false;
  if (CELL_TYPES.has(doc.type ?? "")) {
    const attrs = doc.attrs;
    if (attrs != null && (colorAttrIsBroken(attrs.dataColor) || colorAttrIsBroken(attrs.backgroundColor))) {
      return true;
    }
  }
  for (const child of content) {
    if (child != null && hasCellColorAttrQuirk(child)) return true;
  }
  return false;
}

/** Normalize cell color attrs in place: a non-string dataColor or
 *  backgroundColor becomes null. Well-formed strings are kept untouched —
 *  render-side sanitization (safeColorValue) stays the authority on what
 *  may reach an inline style. */
export function normalizeCellColorAttrsJSON<T extends JsonNode>(doc: T): void {
  const walk = (node: JsonNode): void => {
    if (CELL_TYPES.has(node.type ?? "") && node.attrs != null) {
      if (colorAttrIsBroken(node.attrs.dataColor)) {
        node.attrs.dataColor = null;
      }
      if (colorAttrIsBroken(node.attrs.backgroundColor)) {
        node.attrs.backgroundColor = null;
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        if (child != null) walk(child);
      }
    }
  };
  if (doc != null) walk(doc);
}
