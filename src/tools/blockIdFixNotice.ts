import { Notice } from "obsidian";

/**
 * One restrained user-facing notice for automatic block-id repairs
 * (spec um-cli §4.5: a fixed conflict must be reported — the diag log alone
 * is invisible: the write-log setting is off by default and console.warn
 * never reaches the UI). Session-debounced: the first repair shows the
 * notice, follow-up repairs within the window stay silent — a defective
 * document must not turn into a notification stream.
 */
const NOTICE_DEBOUNCE_MS = 10 * 60 * 1000;
let lastShownAt = 0;

export function notifyBlockIdsRepaired(repaired: number): void {
  const now = Date.now();
  if (now - lastShownAt < NOTICE_DEBOUNCE_MS) return;
  lastShownAt = now;
  new Notice(
    `inscriptum: repaired ${repaired} block id${repaired === 1 ? "" : "s"} in this note`,
    6000,
  );
}

/** Test hook: reset the session debounce. */
export function resetBlockIdNoticeDebounce(): void {
  lastShownAt = 0;
}
