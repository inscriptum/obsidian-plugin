import type { JSONContent } from "../texto/core/@types";
import { extractNoteTitle } from "../storage/fileNaming";

/** Maximum description length for the meta tags / preview. */
const MAX_DESCRIPTION_LENGTH = 200;

export interface NotePreview {
  title: string;
  description: string;
  /** Vault path of the first image node, or null when the note has none. */
  previewImageId: string | null;
}

/** Escapes a plain-text description for use inside a double-quoted HTML
 *  attribute. Same replacements as the blog's redactorContent2Preview. */
export function escapeDescription(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Collects the plain text of a node's inline content. */
function plainText(node: JSONContent | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(plainText).join("");
}

/** Recursively finds the first node of the given type. */
function findFirstNode(node: JSONContent, type: string): JSONContent | null {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const found = findFirstNode(child, type);
    if (found != null) return found;
  }
  return null;
}

/** The name of the title-page property the meta description is read from
 *  (spec 9.1) — mirrors the storage layer's DESCRIPTION_PROPERTY_NAME
 *  (kept as a literal: the export must not depend on the storage layer). */
const DESCRIPTION_PROPERTY = "description";

/** The plain text of a property's values, joined for the meta line. */
function propertyText(node: JSONContent): string {
  const values = (node.content ?? []).filter(
    (child) => child.type === "notePropertyValue",
  );
  const texts = values
    .map((value) => {
      // Hard breaks inside a value become spaces in the flat meta line.
      return plainText(value);
    })
    .filter((text) => text.length > 0);
  return texts.join(", ");
}

/**
 * Builds the preview metadata for the export page:
 *  - title from the noteTitle node;
 *  - description from the title page's `description` property (spec 9.1,
 *    title v3), else from the legacy noteSummary line (pre-v3 title
 *    pages), else the first paragraph;
 *  - preview image from the first image node.
 */
export function extractPreview(doc: JSONContent): NotePreview {
  const title = extractNoteTitle(doc).trim();

  let description = "";
  for (const node of doc.content ?? []) {
    if (node.type === "noteTitle") continue;
    if (node.type === "noteProperty") {
      const name = (node.content ?? []).find(
        (child) => child.type === "notePropertyName",
      );
      // Case-insensitive: the editor locks any casing of the preset name
      // ("Description" typed by hand stays capitalized in the document).
      if (plainText(name).trim().toLowerCase() !== DESCRIPTION_PROPERTY) continue;
      description = propertyText(node).trim();
      if (description) break;
      continue;
    }
    if (node.type === "noteSummary" || node.type === "paragraph") {
      description = plainText(node).trim();
      if (description) break;
    }
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    description = `${description.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
  }

  const image = findFirstNode(doc, "image");
  // PM stores node attrs as `Record<string, any>`; narrow to the one field
  // the preview needs instead of letting `any` leak into the id.
  const imageData = image?.attrs?.data as { id?: unknown } | undefined;
  const previewImageId = typeof imageData?.id === "string" ? imageData.id : null;

  return { title, description: escapeDescription(description), previewImageId };
}
