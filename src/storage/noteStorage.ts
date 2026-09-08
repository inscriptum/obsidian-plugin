import type { TFile, Vault } from "obsidian";
import type { JSONContent } from "../texto/core/@types";

export const EMPTY_DOC: JSONContent = {
  type: "noteDoc",
  content: [{ type: "noteTitle" }, { type: "paragraph" }],
};

export function createEmptyNote(): JSONContent {
  return JSON.parse(JSON.stringify(EMPTY_DOC)) as JSONContent;
}

export async function readNote(
  file: TFile,
  vault: Vault,
): Promise<JSONContent> {
  const raw = await vault.read(file);
  return parseNoteDoc(raw);
}
export interface NoteWithRaw {
  doc: JSONContent;
  /** Exact file contents the doc was parsed from. Used to tell our own
   *  writes apart from external modifications (see NoteView). */
  raw: string;
}

/** Like readNote, but also returns the raw file string so callers can diff
 *  against later disk states without re-serializing. */
export async function readNoteWithRaw(
  file: TFile,
  vault: Vault,
): Promise<NoteWithRaw> {
  const raw = await vault.read(file);
  return { doc: parseNoteDoc(raw), raw };
}

/** Parse a raw .note file string into a document. Throws on invalid JSON —
 *  callers must NOT fall back to an empty note for an existing file: an
 *  empty doc loaded into the editor gets persisted by autosave and wipes
 *  the real content (see issues/empty-note-wipe-guard). */
export function parseNoteDoc(raw: string): JSONContent {
  return JSON.parse(raw) as JSONContent;
}

/** True when the doc is the pristine empty note shape: a noteDoc whose
 *  content is only empty blocks (no text, no meaningful attributes, no
 *  children carrying content). Used by the write guard in NoteView: such a
 *  doc must never overwrite a file that has real content. */
export function isEmptyNoteDoc(doc: JSONContent): boolean {
  if (doc?.type !== "noteDoc" || !Array.isArray(doc.content)) return false;
  return doc.content.every((node) => !nodeCarriesContent(node));
}

function nodeCarriesContent(node: JSONContent): boolean {
  if (typeof node.text === "string" && node.text.trim().length > 0) {
    return true;
  }
  // Nodes like image/attachment/code blocks carry their payload in attrs —
  // any non-empty attrs means there is something to preserve.
  if (
    node.attrs != null &&
    typeof node.attrs === "object" &&
    Object.keys(node.attrs).length > 0
  ) {
    return true;
  }
  return (
    Array.isArray(node.content) && node.content.some(nodeCarriesContent)
  );
}

export async function writeNote(
  file: TFile,
  vault: Vault,
  content: JSONContent,
): Promise<void> {
  await vault.modify(file, JSON.stringify(content, null, 2));
}
