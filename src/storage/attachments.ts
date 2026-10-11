import type { App, TFile } from "obsidian";
import { Platform } from "obsidian";
import { sanitizeFileName } from "./fileNaming";

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
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1) : "";
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
    !folderPath || folderPath === "/"
      ? ""
      : folderPath.endsWith("/")
        ? folderPath
        : `${folderPath}/`;
  const name = ext ? `${baseName}.${ext}` : baseName;
  let candidate = `${folder}${name}`;
  let n = 1;
  while (exists(candidate)) {
    const suffix = `-${n}`;
    candidate = ext
      ? `${folder}${baseName}${suffix}.${ext}`
      : `${folder}${baseName}${suffix}`;
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
  const folderPath = noteFile.parent?.path ?? "/";
  const originalName = file.name || "attachment";
  const ext = getExtension(originalName);
  const rawBase = ext ? originalName.slice(0, -(ext.length + 1)) : originalName;
  const baseName = sanitizeFileName(rawBase) || "attachment";

  const path = buildUniquePath(
    folderPath,
    baseName,
    ext,
    (p) => !!app.vault.getAbstractFileByPath(p),
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
export async function deleteAttachmentFile(
  app: App,
  id: string | null | undefined,
): Promise<void> {
  if (!id) return;
  const file = app.vault.getAbstractFileByPath(id);
  if (file) {
    // respect user's deletion preference (system trash / Obsidian trash / permanent)
    await app.fileManager.trashFile(file);
  }
}

/** A picked file classified against the vault (see resolvePickedFile). */
export type ResolvedPickedFile =
  | {
      /** Already inside the vault — attach as an internal link (no copy). */
      kind: "internal";
      id: string;
      src: string;
      filename: string;
      size: string;
    }
  | {
      /** Outside the vault — desktop offers copy vs external absolute path. */
      kind: "external";
      absPath: string;
      filename: string;
      size: string;
    };

/** Absolute path of a picked file, or null when the platform hides it. */
export function getPickedFilePath(file: File): string | null {
  const direct = (file as File & { path?: unknown }).path;
  if (typeof direct === "string" && direct.length > 0) return direct;
  // Electron ≥ 32 removed File.path — webUtils is the supported way.
  const req = (window as { require?: (m: string) => unknown }).require;
  if (Platform.isDesktop && typeof req === "function") {
    try {
      const webUtils = (
        req("electron") as {
          webUtils?: { getPathForFile?: (f: File) => string };
        }
      ).webUtils;
      const path = webUtils?.getPathForFile?.(file);
      if (typeof path === "string" && path.length > 0) return path;
    } catch {
      // no electron module in this renderer — fall through
    }
  }
  return null;
}

/** Vault root as an absolute filesystem path, or null when unavailable. */
export function getVaultBasePath(app: App): string | null {
  const adapter = app.vault.adapter as { getBasePath?: () => string };
  if (typeof adapter.getBasePath !== "function") return null;
  try {
    const base = adapter.getBasePath();
    return base.length > 0 ? base : null;
  } catch {
    return null;
  }
}

/** Vault-relative part of an absolute path, or null when it lies outside the vault root. */
export function relativeToVault(
  basePath: string,
  absPath: string,
): string | null {
  // macOS pickers are not consistent about Unicode form (NFD vs NFC) —
  // "ё" in "Ещё" is one code point in NFC and two in NFD. Normalize both
  // sides before comparing, or such names never match the vault root.
  const norm = (p: string) =>
    p
      .normalize("NFC")
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "");
  const base = norm(basePath);
  const full = norm(absPath);
  // Prefix compare is case-insensitive: Windows paths are case-insensitive
  // and macOS vaults usually are; a false "outside" only loses the shortcut,
  // a false "inside" is guarded by the vault index check in resolvePickedFile.
  if (!full.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return null;
  return full.slice(base.length + 1);
}

/**
 * Vault id for a vault-relative picked path, tolerant to Unicode-form
 * mismatches between what the OS picker handed us and the vault index:
 * exact hit first, then the NFC/NFD forms, then a normalized scan over the
 * index — the returned id is always in the index's own form, so every later
 * getAbstractFileByPath/getResourcePath lookup works.
 */
function resolveVaultId(app: App, relPath: string): string | null {
  if (app.vault.getAbstractFileByPath(relPath)) return relPath;
  for (const form of new Set([relPath.normalize("NFC"), relPath.normalize("NFD")])) {
    if (form !== relPath && app.vault.getAbstractFileByPath(form)) return form;
  }
  const target = relPath.normalize("NFC").toLowerCase();
  let found: string | null = null;
  (app.vault.getFiles?.() ?? []).some((f) => {
    if (f.path.normalize("NFC").toLowerCase() === target) {
      found = f.path;
      return true;
    }
    return false;
  });
  return found;
}

/**
 * Classifies a picked file for the link-or-copy fork:
 *  - already in the vault → internal link (id = vault-relative path), no copy;
 *  - outside the vault → external absolute path;
 *  - null — the absolute path is unavailable (mobile pickers): caller copies.
 */
export function resolvePickedFile(
  app: App,
  file: File,
): ResolvedPickedFile | null {
  const absPath = getPickedFilePath(file);
  if (!absPath) return null;
  const filename =
    file.name || absPath.split(/[\\/]/).pop() || "attachment";
  const size = String(file.size);
  const basePath = getVaultBasePath(app);
  const relPath = basePath ? relativeToVault(basePath, absPath) : null;
  const id = relPath ? resolveVaultId(app, relPath) : null;
  if (id) {
    return {
      kind: "internal",
      id,
      src: app.vault.adapter.getResourcePath(id),
      filename,
      size,
    };
  }
  return { kind: "external", absPath, filename, size };
}
