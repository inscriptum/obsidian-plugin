import type { JSONContent } from "../../core/@types";

/**
 * Read-time migration for stored documents. Three generations wrote
 * wikilinks differently from the current model (an INLINE ATOM node
 * { type: "wikiLink", attrs: { path, text } }):
 *
 * - the atom node (current) — untouched;
 * - wikiLink MARKS (rounds 1–2 and the rounds-7 mark builds) — converted
 *   to the atom node (label from the marked text);
 * - raw «[[target|label]]» / «[[target]]» patterns in plain text
 *   (rounds 3–6) — converted to the atom node.
 *
 * Incomplete patterns stay literal (there is nothing to link); text inside
 * code blocks and inline code stays literal too — code is quoted, not live.
 */

const WIKI_RE = /\[\[([^[|]+)(?:\|([^[]*))?\]\]/g;
/** Non-global twin for stateless `.test()` checks (a /g regex keeps
 *  lastIndex across calls). */
const WIKI_HAS_RE = /\[\[([^[|]+)(?:\|([^[]*))?\]\]/;

const isCodeContext = (node: JSONContent, inCode: boolean): boolean =>
  inCode ||
  node.type === "hljsCodeBlock" ||
  node.type === "hljsCodeBlockRow" ||
  node.marks?.some((m) => m.type === "code") === true;

/** A wikiLink atom node built from a target + optional label. */
const wikiNode = (path: string, label: string): JSONContent => ({
  type: "wikiLink",
  attrs: { path, text: label },
});

export function hasLegacyWikiSyntax(doc: JSONContent): boolean {
  return walkHas(doc, false);
}

function walkHas(node: JSONContent, inCode: boolean): boolean {
  const isCode = isCodeContext(node, inCode);
  if (
    !isCode &&
    node.type === "text" &&
    typeof node.text === "string" &&
    // legacy generations: plain raw patterns AND wikiLink-marked runs
    (WIKI_HAS_RE.test(node.text) ||
      node.marks?.some((m) => m.type === "wikiLink") === true)
  ) {
    return true;
  }
  return node.content?.some((child) => walkHas(child, isCode)) ?? false;
}

export function convertLegacyWikiSyntax<T extends JSONContent>(doc: T): T {
  return walkConvert(doc, false) as T;
}

function walkConvert(node: JSONContent, inCode: boolean): JSONContent {
  const isCode = isCodeContext(node, inCode);

  // wikiLink MARKS (rounds 1–2 / rounds-7 mark builds) → the atom node.
  // The node replaces the whole text run; other marks on the run (bold
  // inside a label) are dropped — an atom has no marks of its own.
  if (
    !isCode &&
    node.type === "text" &&
    typeof node.text === "string" &&
    node.marks?.some((m) => m.type === "wikiLink")
  ) {
    const wiki = node.marks.find((m) => m.type === "wikiLink");
    const rawPath: unknown = wiki?.attrs?.path;
    const path = typeof rawPath === "string" ? rawPath : "";
    if (path !== "") {
      return wikiNode(path, node.text);
    }
  }

  const converted: JSONContent = { ...node };
  if (converted.content) {
    converted.content = converted.content.map((child) =>
      walkConvert(child, isCode),
    );
  }

  // Raw «[[target|label]]» plain-text patterns (rounds 3–6) → the atom
  // node, splitting the text node around them.
  if (
    !isCode &&
    converted.type === "text" &&
    typeof converted.text === "string" &&
    !converted.marks?.some((m) => m.type === "wikiLink") &&
    WIKI_RE.test(converted.text)
  ) {
    WIKI_RE.lastIndex = 0;
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
      const label = match[2] != null && match[2] !== "" ? match[2] : target;
      parts.push(wikiNode(target, label));
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
  // content was split into several nodes).
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
