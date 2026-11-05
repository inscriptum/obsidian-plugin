/**
 * The pre-write gate for notepad saves (issues/um-external-change-watch).
 *
 * A notepad view can miss the vault "modify" event for an external write
 * (watcher race, event storm), and its autosave flushes fire on many
 * triggers (leaf-blur, drag-reorder, …). Without a disk check the flush
 * silently overwrites the external version with the stale in-memory
 * notepad — the 2026-11-05 issues.um incident. The gate re-checks the
 * file's fingerprint right before every real write, so an unobserved
 * external change can never be clobbered by an automatic save: it either
 * defers to the already-open conflict dialog or opens one.
 */

export type ExternalWriteDecision =
  /** Disk matches what the notepad last reflected — proceed with the write. */
  | { action: "write" }
  /** An unobserved external change exists and the conflict dialog is
   *  already open — skip the write; the dialog's resolution handles it. */
  | { action: "block" }
  /** An unobserved external change exists and the user must choose which
   *  version wins before anything is written. */
  | { action: "modal" };

export interface ExternalWriteInput {
  /** Current on-disk fingerprint (stat mtime:size); null when the file
   *  cannot be stat'ed (e.g. deleted) — never block saving in that case,
   *  the write path recreates the file. */
  diskFingerprint: string | null;
  /** Fingerprint of the state the notepad last loaded or wrote. */
  savedFingerprint: string | null;
  /** The conflict dialog is already up for this file. */
  conflictModalOpen: boolean;
  /** The user explicitly chose "Keep my changes" for the currently
   *  observed external version — the write must go through. */
  bypassExternalCheck: boolean;
}

export function resolveExternalWrite(
  input: ExternalWriteInput,
): ExternalWriteDecision {
  if (input.bypassExternalCheck) return { action: "write" };
  if (input.diskFingerprint === null) return { action: "write" };
  if (input.diskFingerprint === input.savedFingerprint) {
    return { action: "write" };
  }
  return input.conflictModalOpen ? { action: "block" } : { action: "modal" };
}

/** Known limitation (accepted): the gate checks the disk, but an external
 *  write landing between that check and the atomic rename (TOCTOU) is still
 *  silently overwritten — closing that window needs cross-process locking,
 *  out of scope (issues/um-external-change-watch, constraints). The gate
 *  narrows the loss window from "any flush after a missed event" to this
 *  single millisecond-scale race. */
