import type { App, TFile } from "obsidian";
import { Notice, Platform } from "obsidian";

import {
  type ResolvedPickedFile,
  resolvePickedFile,
  saveAttachmentFile,
} from "../storage/attachments";
import type {
  AttachmentOptions,
} from "../texto/extensions/attachment/attachment";
import { AttachFileModal } from "../ui/attachFileModal";

export type AttachmentUpdateFn = (
  attrs: Omit<AttachmentOptions["attributes"], "key">,
) => void;

/** Injectable choice step for tests; the default opens AttachFileModal. */
export type AttachChoiceDialog = (options: {
  filename: string;
  sizeLabel: string;
  onCopy: () => void;
  onExternal: () => void;
  onDismiss: () => void;
}) => void;

/**
 * Attach flow for the "attachment is always a link" policy:
 *  - the file is already in the vault → internal link, no copy, no dialog;
 *  - outside the vault on desktop → honest copy-vs-external-link dialog;
 *  - path unavailable (mobile pickers) → copy into the vault silently.
 * The file itself is only ever written by the copy branch — attach never
 * deletes or renames anything (rule-open-file-safety).
 */
export async function attachSelectedFile(
  app: App,
  noteFile: TFile,
  file: File | null,
  update: AttachmentUpdateFn,
  cancel: () => void,
  choose: AttachChoiceDialog | null = null,
): Promise<void> {
  if (!file) return;
  update({
    state: {
      fileStatus: "loading",
      text: file.name,
      subtext: "",
      preparedData: undefined,
    },
    data: undefined,
  });

  let resolved: ResolvedPickedFile | null;
  try {
    resolved = resolvePickedFile(app, file);
  } catch (err) {
    update({
      state: { fileStatus: "none", text: String(err), preparedData: undefined },
    });
    return;
  }

  if (resolved?.kind === "internal") {
    update({
      state: {
        fileStatus: "attached",
        src: resolved.src,
        text: resolved.filename,
        subtext: "",
        preparedData: undefined,
      },
      data: {
        id: resolved.id,
        size: resolved.size,
        filename: resolved.filename,
      },
    });
    return;
  }

  if (resolved?.kind === "external" && Platform.isDesktop) {
    const show: AttachChoiceDialog =
      choose ??
      ((options) => {
        new AttachFileModal(app, options).open();
      });
    show({
      filename: resolved.filename,
      sizeLabel: formatFileSize(file.size),
      onCopy: () => {
        void copyIntoVault(app, noteFile, file, update);
      },
      onExternal: () => {
        update({
          state: {
            fileStatus: "attached",
            text: resolved.filename,
            subtext: resolved.absPath,
            preparedData: undefined,
          },
          data: {
            id: resolved.absPath,
            size: resolved.size,
            filename: resolved.filename,
            mode: "external",
          },
        });
      },
      onDismiss: cancel,
    });
    return;
  }

  await copyIntoVault(app, noteFile, file, update);
}

/** The existing copy-next-to-note path (buildUniquePath + createBinary). */
async function copyIntoVault(
  app: App,
  noteFile: TFile,
  file: File,
  update: AttachmentUpdateFn,
): Promise<void> {
  try {
    const saved = await saveAttachmentFile(app, noteFile, file);
    update({
      state: {
        fileStatus: "attached",
        src: saved.src,
        text: saved.filename,
        subtext: "",
        preparedData: undefined,
      },
      data: {
        id: saved.id,
        size: saved.size,
        filename: saved.filename,
      },
    });
  } catch (err) {
    update({
      state: { fileStatus: "none", text: String(err), preparedData: undefined },
    });
  }
}

/**
 * Opens an attachment's file with the system default app: in-vault links
 * through Obsidian, external absolute paths through the Electron shell
 * (openWithDefaultApp expects vault paths). A missing file explains itself
 * with a Notice instead of failing silently.
 */
export function openAttachmentFile(
  app: App,
  data:
    | { id?: string | null; mode?: string | null }
    | null
    | undefined,
): void {
  const id = data?.id;
  if (!id) return;

  if (data?.mode !== "external") {
    if (!app.vault.getAbstractFileByPath(id)) {
      new Notice(`File not found in vault: ${id}`);
      return;
    }
    openWithObsidian(app, id);
    return;
  }

  const shell = getElectronShell();
  if (shell?.openPath) {
    // Resolves with an empty string on success, an error message otherwise.
    void shell.openPath(id).then((result) => {
      if (result) new Notice(`Cannot open file: ${id}`);
    });
    return;
  }
  openWithObsidian(app, id);
}

function openWithObsidian(app: App, path: string): void {
  (app as { openWithDefaultApp?: (path: string) => void }).openWithDefaultApp?.(
    path,
  );
}

function getElectronShell():
  | { openPath?: (p: string) => Promise<string> }
  | undefined {
  const req = (window as { require?: (m: string) => unknown }).require;
  if (Platform.isDesktop && typeof req !== "function") return undefined;
  try {
    return (
      req?.("electron") as {
        shell?: { openPath?: (p: string) => Promise<string> };
      }
    ).shell;
  } catch {
    return undefined;
  }
}

/** "1.2 MB" — for the attach dialog's file line. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
