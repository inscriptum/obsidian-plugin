import type { EditorView } from "prosemirror-view";
import { tableEditingKey } from "prosemirror-tables";
import type { ResolvedPos } from "prosemirror-model";

import {
  cancelPendingCellGesture,
  consumeTouchCompatMouse,
  endCellDrag,
  isTouchCompatMouseSuppressed,
} from "./cellDragFreeze";
import { TextoCellSelection } from "./TextoCellSelection";

/**
 * Shift of the point up-left on the first move of a drag: the pointer stands
 * on the selection circle (in the corner of a cell, on top of the content and
 * outside the document tree).
 * The circle has a touch zone enlarged by 10px (::before, inset: -10px,
 * see mobile.css), so the clearance must exceed it.
 *
 * On narrow columns (phone) a fixed shift can throw the point outside the
 * cell, so the point is taken with a progressively decreasing shift — until
 * the first hit inside a cell (see the CLEARANCE_STEPS loop).
 */
const CELL_AT_POINT_STEPS = [1, 0.66, 0.33, 0] as const;

/**
 * Finds the cell under the given screen point.
 *
 * `offset` shifts the point up-left. On the mobile long-press drag the
 * first move stands where the finger landed — no shift is needed there, but
 * the parameter is kept for callers that resolve a point on a gesture
 * overlay.
 */
export function cellAtPoint(
  view: EditorView,
  clientX: number,
  clientY: number,
  offset = 0,
): ResolvedPos | null {
  for (const step of CELL_AT_POINT_STEPS) {
    const shift = Math.round(offset * step);
    const x = clientX - shift;
    const y = clientY - shift;

    const pos = view.posAtCoords({ left: x, top: y });
    if (!pos) continue;

    const $pos = view.state.doc.resolve(pos.pos);
    const cell = $pos.nodeAfter;
    if (
      cell &&
      (cell.type.name === "tableCell" || cell.type.name === "tableHeader")
    )
      return $pos;

    // posAtCoords usually points inside the paragraph text or on the border
    // of the cell content — walk up the hierarchy to the cell.
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      // .spec is untyped (any) in prosemirror-model — cast explicitly.
      const role = $pos.node(depth).type.spec.tableRole as string | undefined;
      if (role === "cell" || role === "header_cell") {
        return $pos.doc.resolve($pos.before(depth));
      }
    }
  }
  return null;
}

/**
 * The desktop/mobile compatibility-mousedown guard (issue
 * table-selection-native-drag, ex circle selection).
 *
 * After a touch cell drag Android dispatches synthetic mouse events; the
 * mousedown would collapse the freshly built TextoCellSelection back to a
 * text cursor, and a pending long-press can no longer be (the finger has
 * lifted). This handler swallows that mousedown and ends the drag so the
 * column-resize handles reappear.
 *
 * Everything else returns false: the native mouse handling takes over —
 * a click places the caret, a drag builds the cell rectangle, holding
 * still selects the cell (the desktop long-press lives in
 * handleCellSelection.ts).
 */
export function handleMouseDown(
  view: EditorView,
  startEvent: MouseEvent,
): boolean {
  if (
    isTouchCompatMouseSuppressed() &&
    view.state.selection instanceof TextoCellSelection
  ) {
    startEvent.preventDefault();
    endCellDrag();
    consumeTouchCompatMouse();
    if (tableEditingKey.getState(view.state) != null) {
      view.dispatch(view.state.tr.setMeta(tableEditingKey, -1));
    }
    return true;
  }

  // A mousedown proves the finger has lifted (compat mouse events are only
  // dispatched after the touch ends) — a pending long-press can no longer be.
  cancelPendingCellGesture();
  return false;
}
