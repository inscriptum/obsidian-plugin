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
  return Array.isArray(node.content) && node.content.some(nodeCarriesContent);
}

/** Write a note doc to disk (JSON, pretty-printed) with a write-log entry
 *  (see logNoteWrite). */
export async function writeNote(
  file: TFile,
  vault: Vault,
  content: JSONContent,
  trigger = "unknown",
): Promise<void> {
  const data = JSON.stringify(content, null, 2);
  await writeNoteRaw(file, vault, data, trigger);
}

/**
 * Persist note content ATOMICALLY: the data lands in a hidden temp file in
 * the same directory, then a single rename replaces the target. A plain
 * truncate+write (vault.modify → fs.writeFile) leaves a 0-byte file behind
 * when the renderer dies mid-write — exactly what wiped a real note during a
 * hot plugin reload (issues/empty-note-wipe-guard, 2026-09-15 incident).
 *
 * Replace step, in order of preference:
 *  1. desktop: node fs.rename over the existing target — truly atomic
 *     (readers see old or new content, never a truncated file);
 *  2. adapter rename (target absent — e.g. first save);
 *  3. adapter remove + rename (target present on mobile): a tiny window
 *     where the target is missing, but the temp file with the full new
 *     content survives any crash and is reported in the write log.
 *
 * On failure the temp file is kept (it holds the complete new content and
 * is named in the log entry) — never delete the only good copy.
 */
/**
 * Replace the target file's content with the temp file's content.
 *
 * 1. Desktop (node available): fs.rename over the existing target —
 *    ATOMIC. Obsidian's own adapter.rename refuses to overwrite an existing
 *    destination ("Destination file already exists!"), so the raw fs call
 *    is the only true replace here.
 * 2. Adapter rename — works when the target does not exist yet.
 * 3. Adapter remove + rename — target exists on mobile/no-node: a tiny
 *    missing-file window, mitigated by keeping the temp file on failure.
 */
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
    // fall through to remove + rename.
  }
  await adapter.remove(targetPath);
  await adapter.rename(tmpPath, targetPath);
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

export async function writeNoteRaw(
  file: TFile,
  vault: Vault,
  data: string,
  trigger = "unknown",
): Promise<void> {
  const adapter = vault.adapter;
  const slash = file.path.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.path.slice(0, slash);
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // Dot-prefixed → Obsidian's file explorer ignores the temp file.
  const tmpPath = `${dir ? `${dir}/` : ""}.${file.name}.${unique}.tmp`;

  const started = Date.now();
  let priorBytes: number | null = null;
  try {
    priorBytes = (await adapter.stat(file.path)).size;
  } catch {
    // no prior file (or stat unavailable) — logged as null
  }

  let result: NoteWriteLogEntry["result"] = "ok";
  let error: string | undefined;
  try {
    await adapter.write(tmpPath, data);
    await replaceFile(vault, tmpPath, file.path);
    // Verify the file on disk actually holds what we wrote — a mismatch
    // means the storage layer lied about the write succeeding.
    try {
      const after = await adapter.stat(file.path);
      if (data.length > 0 && after.size === 0) {
        result = "verify-failed";
        console.error(
          `[inscriptum] Write verification failed for "${file.path}": file is 0 bytes after a ${data.length}-byte write.`,
        );
      }
    } catch {
      // stat after write is best-effort; the replace already succeeded
    }
  } catch (err) {
    result = "error";
    error = `${String(err)} (new content kept in ${tmpPath})`;
    void logNoteWrite(vault, {
      kind: "note-write",
      ts: new Date().toISOString(),
      trigger,
      path: file.path,
      bytes: data.length,
      priorBytes,
      result,
      error,
      durationMs: Date.now() - started,
    });
    // Surface the recovery location to the user of this function, not just
    // to the log: the temp file holds the only complete copy of the content.
    throw new Error(`${String(err)} (new content kept in ${tmpPath})`);
  }

  void logNoteWrite(vault, {
    kind: "note-write",
    ts: new Date().toISOString(),
    trigger,
    path: file.path,
    bytes: data.length,
    priorBytes,
    result,
    durationMs: Date.now() - started,
  });
}

/** localStorage flag for the write log — kept as a dev/quick override:
 *  localStorage.setItem("inscriptum-write-log", "1").
 *  The durable switch is the plugin setting (see setWriteLogEnabled). */
const WRITE_LOG_FLAG = "inscriptum-write-log";
/** Hidden file at the vault root — JSON lines, one event per line. General
 *  plugin activity log: entries carry a `kind` field ("note-write" today,
 *  more kinds can join later). Dot-prefixed → invisible in the file
 *  explorer, easy to attach to a bug report. */
const LOG_PATH = ".inscriptum-log.jsonl";

/** Plugin-setting override, driven by the settings toggle in main.ts.
 *  Off by default: nothing is written until either the setting or the
 *  localStorage flag is on. */
let writeLogForced = false;

/** Durable on/off switch for the write log (plugin settings tab). */
export function setWriteLogEnabled(enabled: boolean): void {
  writeLogForced = enabled;
}

export function isWriteLogEnabled(): boolean {
  if (writeLogForced) return true;
  try {
    return window.localStorage.getItem(WRITE_LOG_FLAG) === "1";
  } catch {
    return false;
  }
}

export interface NoteWriteLogEntry {
  /** What kind of event this is — the general log hosts several kinds. */
  kind: "note-write";
  ts: string;
  /** What initiated the save: autosave | blur | unload-file | close |
   *  conflict-keep-local | blocked-empty | unknown. */
  trigger: string;
  path: string;
  bytes: number;
  /** Disk size before the write; null when unknown (e.g. no prior file). */
  priorBytes: number | null;
  result: "ok" | "verify-failed" | "error" | "blocked";
  error?: string;
  durationMs: number;
}

/** Append one JSON line describing a note write — ONLY when the write log
 *  is enabled (localStorage flag). Failures never break the save itself. */
export async function logNoteWrite(
  vault: Vault,
  entry: NoteWriteLogEntry,
): Promise<void> {
  if (!isWriteLogEnabled()) return;
  const line = JSON.stringify(entry);
  try {
    await vault.adapter.append(LOG_PATH, `${line}\n`);
  } catch {
    // a broken log must never break a save
  }
}

/** Log a write that the empty-overwrite guard refused (never hit the disk). */
export async function logWriteBlocked(
  vault: Vault,
  path: string,
  trigger: string,
  bytes: number,
): Promise<void> {
  await logNoteWrite(vault, {
    kind: "note-write",
    ts: new Date().toISOString(),
    trigger: `blocked-empty (${trigger})`,
    path,
    bytes,
    priorBytes: null,
    result: "blocked",
    durationMs: 0,
  });
}
