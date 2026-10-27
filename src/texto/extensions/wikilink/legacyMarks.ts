import type { JSONContent } from "../../core/@types";

/**
 * Read-time migration for stored documents. Two generations wrote wikilinks
 * differently from the current model (raw «[[path|text]]» PLAIN TEXT from
 * the rounds-3…6 inline-syntax builds; the current model stores the label
 * carrying a wikiLink mark):
 *
 * - wikiLink MARKS (rounds 1–2 and the current model) — already valid,
 *   untouched;
 * - raw «[[target|label]]» / «[[target]]» patterns in plain text — converted
 *   to the marked form, so they open as links instead of dead brackets.
 *
 * Incomplete patterns stay literal (there is nothing to link); text inside
 * code blocks and inline code stays literal too — code is quoted, not live.
 */

const WIKI_RE = /\[\[([^[|]+)(?:\|([^[]*))?\]\]/g;
/** Non-global twin for stateless `.test()` checks (a /g regex keeps
 *  lastIndex across calls). */
const WIKI_HAS_RE = /\[\[([^[|]+)(?:\|([^[]*))?\]\]/;

export function hasLegacyWikiSyntax(doc: JSONContent): boolean {
  return walkHas(doc, false);
}

function walkHas(node: JSONContent, inCode: boolean): boolean {
  const isCode =
    inCode ||
    node.type === "hljsCodeBlock" ||
    node.type === "hljsCodeBlockRow" ||
    node.marks?.some((m) => m.type === "code") === true;
  if (
    !isCode &&
    node.type === "text" &&
    typeof node.text === "string" &&
    !node.marks?.some((m) => m.type === "wikiLink") &&
    WIKI_HAS_RE.test(node.text)
  ) {
    return true;
  }
  return node.content?.some((child) => walkHas(child, isCode)) ?? false;
}

export function convertLegacyWikiSyntax<T extends JSONContent>(doc: T): T {
  return walkConvert(doc, false) as T;
}

function walkConvert(node: JSONContent, inCode: boolean): JSONContent {
  const isCode =
    inCode ||
    node.type === "hljsCodeBlock" ||
    node.type === "hljsCodeBlockRow" ||
    node.marks?.some((m) => m.type === "code") === true;

  const converted: JSONContent = { ...node };
  if (converted.content) {
    converted.content = converted.content.map((child) =>
      walkConvert(child, isCode),
    );
  }

  if (
    !isCode &&
    converted.type === "text" &&
    typeof converted.text === "string" &&
    !converted.marks?.some((m) => m.type === "wikiLink") &&
    WIKI_RE.test(converted.text)
  ) {
    WIKI_RE.lastIndex = 0;
    // Split the text node around each pattern: plain text runs keep their
    // other marks, each pattern becomes a marked text node.
    const parts: JSONContent[] = [];
    const text = converted.text;
    const baseMarks = converted.marks?.filter((m) => m.type !== "wikiLink");
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKI_RE.exec(text)) !== null) {
      if (match.index > cursor) {
        parts.push({
          type: "text",
          text: text.slice(cursor, match.index),
          ...(baseMarks?.length ? { marks: [...baseMarks] } : {}),
        });
      }
      const target = match[1] ?? "";
      // An empty display («[[path|]]») shows the target — same as the
      // editor's commit paths do.
      const label =
        match[2] != null && match[2] !== "" ? match[2] : target;
      parts.push({
        type: "text",
        text: label,
        marks: [
          ...(baseMarks ?? []),
          { type: "wikiLink", attrs: { path: target } },
        ],
      });
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) {
      parts.push({
        type: "text",
        text: text.slice(cursor),
        ...(baseMarks?.length ? { marks: [...baseMarks] } : {}),
      });
    }
    if (parts.length === 1) {
      return parts[0];
    }
    // Multiple nodes cannot replace a text node in place — signal to the
    // parent by returning a fragment marker the parent unpacks.
    return { type: "__wiki_fragment__", content: parts };
  }

  // Unpack fragment markers produced by children (an inline node whose
  // content was split into several text nodes).
  if (
    converted.content &&
    converted.content.some((child) => child.type === "__wiki_fragment__")
  ) {
    const expanded: JSONContent[] = [];
    for (const child of converted.content) {
      if (child.type === "__wiki_fragment__") {
        expanded.push(...(child.content ?? []));
      } else {
        expanded.push(child);
      }
    }
    converted.content = expanded;
  }
  return converted;
}
