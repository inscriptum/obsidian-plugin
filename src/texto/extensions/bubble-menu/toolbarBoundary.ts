import type { Editor } from "../../core";

/**
 * Floating-menu boundary helpers (task bubble-layer-visibility, owner
 * strategy B: re-place, never hide under the toolbar). The view's own
 * toolbar (note toolbar on NoteView, notepad toolbar on NotepadView) is an
 * obstacle tippy knows nothing about — its bottom edge bounds everything a
 * floating bar or layer may occupy.
 *
 * Desktop-only: the floating menus are not registered on mobile (the bars
 * are docked inside the toolbar there), so the toolbar is always measurable
 * when these helpers run.
 */

/** Viewport Y of the bottom edge of the view's own toolbar. Returns 0 when
 *  no toolbar is found — the caller then only respects the viewport edges
 *  (tippy's own flip behavior). */
export function toolbarBottomY(editor: Pick<Editor, "view">): number {
  const container = editor.view.dom.closest?.(
    ".note-view-container, .notepad-view-container",
  );
  const toolbar = container?.querySelector(
    ".note-toolbar-host, .notepad-toolbar-host",
  );
  if (!toolbar) return 0;
  return toolbar.getBoundingClientRect().bottom;
}

/** Free vertical space between a reference rect and the boundaries: above —
 *  down to the toolbar bottom, below — down to the window bottom. */
export function freeVerticalSpace(
  editor: Pick<Editor, "view">,
  refTop: number,
  refBottom: number,
): { above: number; below: number } {
  const toolbarBottom = toolbarBottomY(editor);
  return {
    above: Math.max(0, refTop - toolbarBottom),
    below: Math.max(0, window.innerHeight - refBottom),
  };
}
