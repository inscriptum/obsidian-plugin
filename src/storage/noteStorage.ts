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
