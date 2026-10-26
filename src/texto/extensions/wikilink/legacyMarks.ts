import type { JSONContent } from "../../core/@types";

/**
 * Migration for documents written by the experimental wikiLink-MARK builds
 * (wikilinks rounds 1–2): prosemirror-model rejects unknown marks at load,
 * so those documents would not open once the mark was replaced by the
 * inline-syntax model. The marked runs convert to the same thing the
 * inline model stores — plain `[[path|text]]` text.
 */

export function hasLegacyWikiMarks(doc: JSONContent): boolean {
  return walkHas(doc);
}

function walkHas(node: JSONContent): boolean {
  if (node.marks?.some((m) => m.type === "wikiLink")) return true;
  return node.content?.some((child) => walkHas(child)) ?? false;
}

export function convertLegacyWikiMarks<T extends JSONContent>(doc: T): T {
  return walkConvert(doc) as T;
}

function walkConvert(node: JSONContent): JSONContent {
  const converted: JSONContent = { ...node };
  if (converted.content) {
    converted.content = converted.content.map((child) => walkConvert(child));
  }
  if (converted.marks?.length) {
    const wiki = converted.marks.find((m) => m.type === "wikiLink");
    converted.marks = converted.marks.filter((m) => m.type !== "wikiLink");
    if (converted.marks.length === 0) delete converted.marks;
    const path = (wiki?.attrs as { path?: unknown } | undefined)?.path;
    if (typeof path === "string" && path !== "" && typeof converted.text === "string") {
      // The mark's text is the display label; the target rides the syntax.
      converted.text = `[[${path}|${converted.text}]]`;
    }
  }
  return converted;
}
