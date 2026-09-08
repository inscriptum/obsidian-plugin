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

/** Parse a raw .note file string into a document, falling back to an empty
 *  note for invalid JSON (mirrors readNote). */
export function parseNoteDoc(raw: string): JSONContent {
  try {
    return JSON.parse(raw) as JSONContent;
  } catch {
    return createEmptyNote();
  }
}

export async function writeNote(
  file: TFile,
  vault: Vault,
  content: JSONContent,
): Promise<void> {
  await vault.modify(file, JSON.stringify(content, null, 2));
}
