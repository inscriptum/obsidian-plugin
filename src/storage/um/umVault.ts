import type { TFile, Vault } from "obsidian";
import { logDiagEvent, logNoteWrite } from "../noteStorage";
import { UmNotebook } from "./umNotebook";

/**
 * Obsidian-facing IO for `.um` containers. The write path mirrors
 * noteStorage's atomic strategy (issues/empty-note-wipe-guard): a hidden
 * temp file first, then a single replace — node fs.rename on desktop,
 * adapter.rename into a fresh path, in-place adapter.writeBinary as the
 * last resort. Never adapter.remove the open file (rule-open-file-safety).
 */

export async function readUmFile(
  file: TFile,
  vault: Vault,
): Promise<UmNotebook> {
  const buffer = await vault.readBinary(file);
  return UmNotebook.fromBytes(new Uint8Array(buffer));
}

/** Create a new `.um` file from an in-memory notebook. */
export async function createUmFile(
  vault: Vault,
  path: string,
  notebook: UmNotebook,
): Promise<TFile> {
  const bytes = notebook.serialize();
  const tfile = await vault.createBinary(path, bufferFrom(bytes));
  return tfile as TFile;
}

/** Atomically persist the notebook and update its saved-state fingerprint. */
export async function writeUmFile(
  file: TFile,
  vault: Vault,
  notebook: UmNotebook,
  trigger = "unknown",
): Promise<void> {
  const started = Date.now();
  const bytes = notebook.serialize();
  const data = bufferFrom(bytes);
  const slash = file.path.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.path.slice(0, slash);
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // Dot-prefixed → invisible to the file explorer, no vault events on cleanup.
  const tmpPath = `${dir ? `${dir}/` : ""}.${file.name}.${unique}.tmp`;

  let priorBytes: number | null = null;
  try {
    priorBytes = (await vault.adapter.stat(file.path))?.size ?? null;
  } catch {
    priorBytes = null;
  }

  let result: "ok" | "error" = "ok";
  let error: string | undefined;
  try {
    await vault.adapter.writeBinary(tmpPath, data);
    await replaceFile(vault, tmpPath, file.path);
    notebook.savedFingerprint = await fingerprintStat(vault, file.path);
  } catch (err) {
    result = "error";
    error = err instanceof Error ? err.message : String(err);
    // The temp copy holds the complete new content — keep it and report it
    // (same policy as noteStorage: never delete the only good copy).
    await logDiagEvent(
      vault,
      `um-write error path=${file.path} tmp=${tmpPath} error=${error}`,
    );
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    await logNoteWrite(vault, {
      kind: "note-write",
      ts: new Date().toISOString(),
      trigger: `um:${trigger}`,
      path: file.path,
      bytes: bytes.byteLength,
      priorBytes,
      result,
      error,
      durationMs: Date.now() - started,
    });
  }
}

/** Fingerprint of the file's last known on-disk state: the notebook's own
 *  writes update it, so vault "modify" events for foreign changes are the
 *  only ones that observe a different value. Null while unknown. */
export async function umFingerprint(
  vault: Vault,
  file: TFile,
): Promise<string | null> {
  return fingerprintStat(vault, file.path);
}

async function fingerprintStat(
  vault: Vault,
  path: string,
): Promise<string | null> {
  try {
    const stat = await vault.adapter.stat(path);
    if (stat == null) return null;
    return `${stat.mtime}:${stat.size}`;
  } catch {
    return null;
  }
}

async function replaceFile(
  vault: Vault,
  tmpPath: string,
  targetPath: string,
): Promise<void> {
  const nodeFs = getNodeFs();
  const adapter = vault.adapter;
  if (nodeFs != null && typeof adapter.getFullPath === "function") {
    nodeFs.renameSync(
      adapter.getFullPath(tmpPath),
      adapter.getFullPath(targetPath),
    );
    return;
  }
  try {
    await adapter.rename(tmpPath, targetPath);
    return;
  } catch {
    // adapter.rename refuses to overwrite an existing destination —
    // fall through to the in-place write.
  }
  // In-place replace of the OPEN notebook file is intentional here:
  // adapter.remove would fire a vault "delete" and close the view
  // (issues/mobile-edit-exits-note, rule-open-file-safety).
  const data = await vault.adapter.readBinary(tmpPath);
  await adapter.writeBinary(targetPath, data);
}

/** The node fs module on desktop Obsidian; null on mobile / when blocked. */
function getNodeFs(): typeof import("node:fs") | null {
  try {
    const req = (window as { require?: (id: string) => unknown }).require;
    if (typeof req !== "function") return null;
    return req("fs") as typeof import("node:fs");
  } catch {
    return null;
  }
}

function bufferFrom(bytes: Uint8Array): ArrayBuffer {
  // Uint8Array.prototype.buffer may be larger than the view — copy exactly.
  return bytes.slice().buffer as ArrayBuffer;
}
