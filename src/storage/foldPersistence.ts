import type { Editor } from "../texto/core";
import {
  getFoldedHeadingPositions,
  headingFoldingKey,
  restoreFoldedHeadings,
} from "../texto/extensions/heading/folding";
import {
  getFoldedTaskPositions,
  restoreFoldedTasks,
  taskFoldingKey,
} from "../texto/extensions/task-item-folding";

/** Device-local persistence for in-document fold state (heading + task
 *  sections), shared by .note (NoteView) and .um pages (NotepadView).
 *  Mirrors the storage approach of Obsidian's own foldManager
 *  (`note-fold-<path>`): the fold state is vault-local metadata, never part
 *  of the note document. Kind prefixes: `inscriptum-note-fold-` (headings,
 *  existing key), `inscriptum-task-fold-` (task subtasks). */

export type FoldKind = "heading" | "task";

/** What the fold state belongs to: the note file path for .note, or
 *  `<containerPath>/<pageId>` for a .um page — a page has no file of its
 *  own, and a file path can never have a segment below it, so the join is
 *  unambiguous. */
export type FoldScope = string;

export function foldStorageKey(kind: FoldKind, scope: string): string {
  const prefix =
    kind === "heading" ? "inscriptum-note-fold-" : "inscriptum-task-fold-";
  return `${prefix}${scope}`;
}

/** Structural subset of Obsidian's App used here. loadLocalStorage/
 *  saveLocalStorage exist since v1.8.7 (typed API), but minAppVersion is
 *  older — access it structurally so both paths are used and the version
 *  rule stays satisfied. loadLocalStorage namespaces the value per vault
 *  like Obsidian's own foldManager does. */
export interface FoldStorageApp {
  loadLocalStorage?: (key: string) => unknown;
  saveLocalStorage?: (key: string, value: unknown) => void;
}

export interface FoldPersistence {
  /** Persist the editor's current fold positions for both kinds (no-op
   *  when nothing changed since the last write). Call from the editor's
   *  onTransaction; fold toggles carry no doc change, so this never marks
   *  the document dirty. */
  sync(editor: Editor): void;
  /** Restore folds saved for the scope into a freshly created editor.
   *  Desktop only — the caller gates that (folding is disabled on mobile). */
  restore(editor: Editor): void;
}

export function createFoldPersistence(
  app: FoldStorageApp,
  /** Live scope resolver, re-read on every access so a renamed note
   *  (NoteView) or renamed container (NotepadView) keeps landing on the
   *  current key without rebuilding the persistence. */
  getScope: () => string | null,
): FoldPersistence {
  /** Last fold positions saved to localStorage, per fold kind; guards
   *  redundant writes. */
  const lastSaved: Record<FoldKind, number[] | null> = {
    heading: null,
    task: null,
  };

  function load(key: string): unknown {
    if (typeof app.loadLocalStorage === "function") {
      return app.loadLocalStorage(key);
    }
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function save(key: string, data: unknown): void {
    if (typeof app.saveLocalStorage === "function") {
      app.saveLocalStorage(key, data);
      return;
    }
    try {
      if (data == null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, JSON.stringify(data));
      }
    } catch {
      // localStorage unavailable (private mode etc.) — folds just won't
      // persist, the editor itself is unaffected.
    }
  }

  function sync(editor: Editor): void {
    syncTarget(editor, "heading", "headingFolding");
    syncTarget(editor, "task", "taskItemFolding");
  }

  function syncTarget(
    editor: Editor,
    kind: FoldKind,
    storageName: string,
  ): void {
    // Folding can be disabled per editor (mobile first iteration): its
    // plugin is absent, so the positions read as an empty list — writing
    // that would WIPE folds saved from a desktop session. No plugin state,
    // no folds to persist: sync is a no-op for that kind.
    const pluginState =
      kind === "heading"
        ? headingFoldingKey.getState(editor.state)
        : taskFoldingKey.getState(editor.state);
    if (pluginState == null) return;

    const positions = (
      editor.storage[storageName] as { positions?: number[] } | undefined
    )?.positions;
    if (positions == null || positions === lastSaved[kind]) return;

    const scope = getScope();
    if (!scope) return;

    // Same guard as Obsidian's foldManager: an empty fold list clears the
    // stored value instead of persisting `[]`.
    lastSaved[kind] = positions;
    save(
      foldStorageKey(kind, scope),
      positions.length > 0 ? { folds: positions } : null,
    );
  }

  function restore(editor: Editor): void {
    restoreTarget(
      editor,
      "heading",
      "headingFolding",
      "heading",
      (view, positions) => restoreFoldedHeadings(view, positions),
    );
    restoreTarget(
      editor,
      "task",
      "taskItemFolding",
      "taskItem",
      (view, positions) => restoreFoldedTasks(view, positions),
    );
  }

  function restoreTarget(
    editor: Editor,
    kind: FoldKind,
    storageName: string,
    nodeTypeName: string,
    restore: (view: Editor["view"], positions: number[]) => void,
  ): void {
    const scope = getScope();
    if (!scope) return;

    const saved = load(foldStorageKey(kind, scope)) as
      | { folds?: number[] }
      | null
      | undefined;
    const folds = saved?.folds;
    if (!Array.isArray(folds) || folds.length === 0) return;

    // Positions saved from a previous session may not match this doc if the
    // note was edited elsewhere; keep only positions that still point at the
    // expected node kind. (The plugin also drops them on later edits via
    // mapping.) The bounds check must come before nodeAt — an out-of-range
    // position throws there, and stale storage must never break the editor.
    const valid = folds.filter((pos) => {
      if (typeof pos !== "number" || !Number.isFinite(pos)) return false;
      if (pos < 0 || pos >= editor.state.doc.content.size) return false;
      const node = editor.state.doc.nodeAt(pos);
      return node?.type.name === nodeTypeName;
    });
    if (valid.length === 0) return;

    restore(editor.view, valid);
    const positions =
      kind === "heading"
        ? getFoldedHeadingPositions(editor.state)
        : getFoldedTaskPositions(editor.state);
    const storage = editor.storage[storageName] as
      | { positions?: number[] }
      | undefined;
    if (storage) storage.positions = positions;
    lastSaved[kind] = positions;
  }

  return { sync, restore };
}
