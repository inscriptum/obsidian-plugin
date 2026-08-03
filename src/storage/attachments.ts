import type { App, TFile } from 'obsidian';
import { sanitizeFileName } from './fileNaming';

export interface SavedFile {
  /** Path to file in the vault (used as data.id / link). */
  id: string;
  /** URL suitable for <img src> and display. */
  src: string;
  /** File size in bytes (as string, as expected in data.size). */
  size: string;
  /** Original file name. */
  filename: string;
}

/** Extracts the extension from a file name (without the dot). */
export function getExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1) : '';
}

/**
 * Builds a file path in the same folder as the note.
 * If a file with that name already exists — appends a suffix `-1`, `-2`, etc.
 */
export function buildUniquePath(
  folderPath: string,
  baseName: string,
  ext: string,
  exists: (path: string) => boolean,
): string {
  const folder =
    !folderPath || folderPath === '/'
      ? ''
      : folderPath.endsWith('/')
        ? folderPath
        : `${folderPath}/`;
  const name = ext ? `${baseName}.${ext}` : baseName;
  let candidate = `${folder}${name}`;
  let n = 1;
  while (exists(candidate)) {
    const suffix = `-${n}`;
    candidate = ext ? `${folder}${baseName}${suffix}.${ext}` : `${folder}${baseName}${suffix}`;
    n++;
  }
  return candidate;
}

/**
 * Saves an attached file to the vault next to the note
 * and returns data for a local file link.
 */
export async function saveAttachmentFile(
  app: App,
  noteFile: TFile,
  file: File,
): Promise<SavedFile> {
  const folderPath = noteFile.parent?.path ?? '/';
  const originalName = file.name || 'attachment';
  const ext = getExtension(originalName);
  const rawBase = ext ? originalName.slice(0, -(ext.length + 1)) : originalName;
  const baseName = sanitizeFileName(rawBase) || 'attachment';

  const path = buildUniquePath(folderPath, baseName, ext, (p) =>
    !!app.vault.getAbstractFileByPath(p),
  );

  const buffer = await file.arrayBuffer();
  await app.vault.createBinary(path, buffer);

  return {
    id: path,
    src: app.vault.adapter.getResourcePath(path),
    size: String(file.size),
    filename: originalName,
  };
}

/**
 * Deletes a file from the vault by path (data.id), if it exists.
 * Silently ignores errors — this is cleanup on node removal.
 */
export async function deleteAttachmentFile(app: App, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const file = app.vault.getAbstractFileByPath(id);
  if (file) {
    await app.vault.delete(file as TFile);
  }
}
