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
function findFirstNode(
  node: JSONContent,
  type: string,
): JSONContent | null {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const found = findFirstNode(child, type);
    if (found != null) return found;
  }
  return null;
}

/**
 * Builds the preview metadata for the export page:
 *  - title from the noteTitle node;
 *  - description from the first paragraph (the blog used a dedicated
 *    summary block, the plugin has none);
 *  - preview image from the first image node.
 */
export function extractPreview(doc: JSONContent): NotePreview {
  const title = extractNoteTitle(doc).trim();

  let description = "";
  for (const node of doc.content ?? []) {
    if (node.type === "noteTitle") continue;
    if (node.type === "paragraph") {
      description = plainText(node).trim();
      if (description) break;
    }
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    description = `${description.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
  }

  const image = findFirstNode(doc, "image");
  const previewImageId =
    typeof image?.attrs?.data?.id === "string" ? image.attrs.data.id : null;

  return { title, description: escapeDescription(description), previewImageId };
}
