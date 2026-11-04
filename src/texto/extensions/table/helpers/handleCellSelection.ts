import type { ResolvedPos } from "prosemirror-model";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import {
  cellAround,
  CellSelection,
  columnResizingPluginKey,
  tableEditingKey,
  TableMap,
} from "prosemirror-tables";
import {
  Decoration,
  DecorationSet,
  DecorationSource,
  EditorView,
} from "prosemirror-view";

import {
  beginCrossCellDrag,
  endCellDrag,
  endCrossCellDrag,
  isCellDragActive,
  isCrossCellDragActive,
  isTouchCompatMouseSuppressed,
  consumeTouchCompatMouse,
} from "./cellDragFreeze";
import { cellAtPoint, handleMouseDown } from "./handleMouseDown";
import {
  cellTable,
  domCellAtPoint,
  handlePointerDown,
  handleTouchMoveDuringDrag,
  handleTouchStart,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
} from "./handleTouchStart";
import { TextoCellSelection } from "./TextoCellSelection";

/**
 * Column resize handles for the mobile view: widgets on the right edge of
 * every visible segment of the current cell's column (rowspan-aware).
 *
 * The segment cell position is recorded in `data-cell-pos` — the touch
 * handler uses it to determine the column being resized.
 */
function getResizeHandleDecorations(
  state: EditorState,
  cellPos: number,
): Decoration[] {
  const $cell = state.doc.resolve(cellPos);
  const table = $cell.node(-1);
  const tableStart = $cell.start(-1);
  const map = TableMap.get(table);
  const col =
    map.colCount($cell.pos - tableStart) +
    (($cell.nodeAfter?.attrs.colspan as number) ?? 1) -
    1;

  const decorations: Decoration[] = [];

  for (let row = 0; row < map.height; row += 1) {
    const index = col + row * map.width;
    const isNewSegment =
      (col === map.width - 1 || map.map[index] !== map.map[index + 1]) &&
      (row === 0 || map.map[index] !== map.map[index - map.width]);

    if (!isNewSegment) {
      continue;
    }

    const segmentPos = map.map[index];
    const segment = table.nodeAt(segmentPos);
    if (!segment) {
      continue;
    }

    const handle = createDiv();
    handle.className = "texto-table__resize-handle";
    handle.dataset.cellPos = String(tableStart + segmentPos);

    decorations.push(
      Decoration.widget(
        tableStart + segmentPos + segment.nodeSize - 1,
        handle,
        {
          key: `texto-table-resize-handle-${col}-${row}`,
        },
      ),
    );
  }

  return decorations;
}

export function drawCellSelection(
  state: EditorState,
  isMobileView: boolean,
): DecorationSource | null {
  // The selection circle is gone on BOTH platforms (issue
  // table-selection-native-drag): desktop selects with the native mouse
  // drag, mobile with the long-press drag — the picked-cell highlight of
  // that gesture is its own direct-DOM rectangle (handleTouchStart.ts), and
  // the selected cells are highlighted by tableEditing's .selectedCell
  // decorations. Mobile keeps the column resize handles.
  if (!isMobileView) {
    return null;
  }

  const decorations: Decoration[] = [];

  // During a selection drag the handles are not needed: recreating them
  // repaints the table subtree mid-gesture.
  if (!isCellDragActive()) {
    const { selection } = state;
    const cellPos =
      selection instanceof CellSelection
        ? selection.$headCell.pos
        : cellAround(selection.$anchor)?.pos;

    if (cellPos != null) {
      decorations.push(...getResizeHandleDecorations(state, cellPos));
    }
  }

  return DecorationSet.create(state.doc, decorations);
}

/**
 * Swallow a synthetic compatibility mouse event from a just-finished touch
 * cell drag, mirroring handleMouseDown (which also clears the drag state).
 */
function swallowTouchCompatMouse(view: EditorView): boolean {
  if (
    isTouchCompatMouseSuppressed() &&
    view.state.selection instanceof TextoCellSelection
  ) {
    endCellDrag();
    consumeTouchCompatMouse();
    if (tableEditingKey.getState(view.state) != null) {
      view.dispatch(view.state.tr.setMeta(tableEditingKey, -1));
    }
    return true;
  }
  return false;
}

export function handleCellSelection(isMobileView: boolean) {
  return new Plugin({
    // Desktop only: right after a long-press hold, PM's DOM-sync flush can
    // read the browser-committed caret and dispatch a selection transaction
    // that collapses the fresh cell selection (racing the re-assert in
    // startDesktopLongPress). Such transactions are blocked for the latch
    // window — the caret inside the cell before the hold must not prevent
    // the long-press from sticking.
    filterTransaction(tr, state) {
      if (isMobileView || tr.docChanged) return true;
      // The deliberate collapse of collapseCellSelectionOnClick passes.
      if (tr.getMeta(cellCollapseClickMeta)) return true;
      // While a cross-cell mouse drag is building the rectangle, the
      // browser's selection changes (anchored at the plain mousedown) must
      // not sync back as a TextSelection — that late flush is what collapses
      // the fresh cell selection after the mouseup (issue
      // table-fast-selection-reset). Cell-selection dispatches (the rectangle
      // itself) and transactions that do not touch the selection pass.
      if (isCrossCellDragActive()) {
        return !tr.selectionSet || tr.selection instanceof CellSelection;
      }
      if (Date.now() > collapseLatchUntil) return true;
      if (!(state.selection instanceof TextoCellSelection)) return true;
      return tr.selection instanceof TextoCellSelection;
    },
    props: {
      decorations: (state) => drawCellSelection(state, isMobileView),

      handleDOMEvents: {
        mousedown: (view, event) => {
          // Hide the selection overlay from the very START of a desktop
          // column-resize drag. columnResizing begins its drag in its own
          // mousedown handler (dispatching setDragging), which runs AFTER ours
          // (plugin order in table.ts), so check the plugin state in a
          // microtask, once all mousedown handlers have had their turn. The
          // mousemove branch below then keeps the class up to date (and
          // removes it after mouseup).
          queueMicrotask(() => {
            if (columnResizingPluginKey.getState(view.state)?.dragging) {
              document.body.classList.add("texto-table__cell-dragging");
            }
          });
          // Desktop: native selection — a click places the caret, an
          // immediate drag builds the cell rectangle (prosemirror-tables'
          // own handler), and holding the button still selects the cell
          // under it (the mouse long-press, the desktop twin of the mobile
          // long-press).
          if (!isMobileView) {
            // A mousedown inside the CURRENT cell selection: the cell
            // selection owns the gesture — dragging inside it must not
            // select text (owner model, issue
            // table-longpress-selection-reset). preventDefault blocks the
            // native caret and the text-selection anchor; a plain click
            // collapses to a caret on mouseup, a drag keeps the selection.
            const target = event.target as HTMLElement | null;
            if (
              target?.closest?.("td.selectedCell, th.selectedCell") &&
              view.state.selection instanceof TextoCellSelection
            ) {
              event.preventDefault();
              collapseCellSelectionOnClick(view, event);
              return true;
            }
            // Only the primary button may start the hold/drag tracker
            // (issue table-fast-selection-reset, PR #21 review): a
            // right-click (context menu) or a middle click would otherwise
            // arm the 450 ms hold with no button held — onUp ignores
            // non-primary releases — and the cell would select itself
            // after the click. onUp keeps its release guard for an
            // existing PRIMARY drag (a stray secondary release must not
            // tear down a live gesture).
            if (event.button !== 0) {
              return false;
            }
            startDesktopLongPress(view, event);
            return false;
          }
          return handleMouseDown(view, event);
        },
        // Swallow the synthetic compatibility mouse events (mouseup/click)
        // that Android dispatches after a touch cell drag: a click would
        // otherwise set a text cursor and collapse the TextoCellSelection.
        mouseup: (view) => swallowTouchCompatMouse(view),
        click: (view) => swallowTouchCompatMouse(view),
        mousemove: (view) => {
          const pluginState = columnResizingPluginKey.getState(view.state);
          const className = "texto-table__cell-dragging";
          const contains = document.body.classList.contains(className);
          if (pluginState?.dragging) {
            if (!contains) {
              document.body.classList.add(className);
            }
            return false;
          }

          if (contains) {
            document.body.classList.remove(className);
          }
          return false;
        },
      },
    },

    // Touch handlers are registered as our own NON-passive listener on
    // view.dom instead of handleDOMEvents.touchstart: ProseMirror adds
    // touch listeners on view.dom as passive (passiveHandlers =
    // { touchstart: true, touchmove: true } in prosemirror-view), so a
    // preventDefault call inside such a listener throws
    // "Unable to preventDefault inside passive event listener" and is
    // ignored. Because of that the drag selection / resize never took the
    // gesture away from document scrolling (the document scrolled during
    // the gesture — "broken" scrolling, and the selection only grew along
    // the scroll path, i.e. diagonally down-right).
    // Our own non-passive listener allows a working preventDefault.
    view(editorView) {
      const onTouchStart = (event: TouchEvent) => {
        handleTouchStart(editorView, event);
      };

      // Long-press cell selection runs on Pointer Events: see
      // handlePointerDown for why touch events cannot be used here.
      const onPointerDown = (event: PointerEvent) => {
        handlePointerDown(editorView, event);
      };

      // While a cell-selection drag is active, touchmove must be
      // prevented or the still-alive touch stream scrolls the document
      // instead of dragging. Registered non-passive for the same reason
      // as touchstart above.
      const onTouchMove = (event: TouchEvent) => {
        handleTouchMoveDuringDrag(event);
      };

      // Suppress the native context menu while a cell drag is active:
      // on Android a long-press fires contextmenu right after the
      // long-press threshold and would interrupt the ongoing selection drag.
      const onContextMenu = (event: MouseEvent) => {
        if (isCellDragActive()) {
          event.preventDefault();
        }
      };

      editorView.dom.addEventListener("touchstart", onTouchStart, {
        passive: false,
      });
      editorView.dom.addEventListener("touchmove", onTouchMove, {
        passive: false,
      });
      editorView.dom.addEventListener("pointerdown", onPointerDown);
      editorView.dom.addEventListener("contextmenu", onContextMenu);
      return {
        destroy() {
          editorView.dom.removeEventListener("touchstart", onTouchStart);
          editorView.dom.removeEventListener("touchmove", onTouchMove);
          editorView.dom.removeEventListener("pointerdown", onPointerDown);
          editorView.dom.removeEventListener("contextmenu", onContextMenu);
        },
      };
    },

    // A CellSelection can appear without going through our handlers
    // (undo/redo, normalizeSelection from tableEditing, fixTables). Replace
    // it with TextoCellSelection so the DOM selection does not stretch over
    // the head cell's text (see TextoCellSelection).
    appendTransaction(_transactions, _oldState, newState) {
      const { selection } = newState;
      if (
        selection instanceof CellSelection &&
        !(selection instanceof TextoCellSelection)
      ) {
        return newState.tr.setSelection(
          new TextoCellSelection(selection.$anchorCell, selection.$headCell),
        );
      }
      return null;
    },
  });
}

/**
 * A mousedown landed inside the current cell selection (desktop): the drag
 * must not turn into a native text selection, so the mousedown was
 * preventDefault-ed. On mouseup a plain click collapses the selection to a
 * caret at the click point; a drag keeps the cell selection as-is.
 */
function collapseCellSelectionOnClick(
  view: EditorView,
  startEvent: MouseEvent,
): void {
  const doc = view.dom.ownerDocument;
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  let dragged = false;
  const onMove = (event: MouseEvent): void => {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (dx * dx + dy * dy > 16) {
      dragged = true;
    }
  };
  const onUp = (): void => {
    doc.removeEventListener("mousemove", onMove);
    doc.removeEventListener("mouseup", onUp);
    if (dragged) return;
    window.setTimeout(() => {
      if (view.isDestroyed) return;
      if (!(view.state.selection instanceof TextoCellSelection)) return;
      const pos = view.posAtCoords({ left: startX, top: startY });
      if (!pos) return;
      view.dispatch(
        view.state.tr
          .setSelection(
            TextSelection.near(view.state.doc.resolve(pos.pos)),
          )
          .setMeta(cellCollapseClickMeta, true),
      );
      view.focus();
    }, 0);
  };
  doc.addEventListener("mousemove", onMove);
  doc.addEventListener("mouseup", onUp);
}

/**
 * How long a just-finished desktop hold is guarded against a late
 * selectionchange flush collapsing the fresh cell selection back to the
 * browser-committed caret.
 */
const COLLAPSE_LATCH_MS = 250;
let collapseLatchUntil = 0;
/** Meta key marking the deliberate click-collapse — never latched out. */
const cellCollapseClickMeta = "textoTableCollapseClick";

/**
 * Body class from the moment the drag leaves its starting cell until the
 * mouseup: the cells become user-select: none, so the native selection
 * machinery cannot (re)engage while the rectangle is being built — the
 * .selectedCell rule only exists AFTER the first CellSelection dispatch
 * (issue table-fast-selection-reset). Body, not the table container: the
 * CellSelection dispatch re-renders the whole table subtree (TableView is
 * destroyed and re-created), so a class on the wrapper lands on a detached
 * node — the body is the established carrier for gesture classes (the
 * texto-table__cell-selecting rule in mobile.css).
 */
const CELL_DRAG_SELECT_CLASS = "texto-table__cell-drag-select";

/**
 * Desktop long-press (issue table-selection-native-drag): holding the mouse
 * button still on a cell for a moment selects that cell — the mouse twin of
 * the mobile long-press, and the only single-cell affordance once the
 * circle is gone. A plain click (release before the timer, or moving out of
 * the slop) stays untouched: the caret was already placed by the default
 * mousedown handling and an immediate drag builds the rectangle natively.
 *
 * The same gesture tracker owns the FAST drag (issue
 * table-fast-selection-reset): once the pointer leaves the starting cell,
 * the native text-selection machinery — anchored at the plain mousedown —
 * is suppressed for the rest of the gesture (selectstart prevention, a
 * user-select guard class, and the crossCell transaction filter), so a fast
 * sweep across cells builds the cell rectangle without ever highlighting
 * text and without the mouseup commit resetting it.
 *
 * While the selection is active, moving extends the rectangle and the
 * moves are preventDefault-ed so the native text-selection drag does not
 * fight the dispatched cell selection.
 */
function startDesktopLongPress(view: EditorView, startEvent: MouseEvent): void {
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  const doc = view.dom.ownerDocument;
  let timer = 0;
  let active = false;
  let anchor: ResolvedPos | null = null;

  // The cell the gesture started in (DOM identity): the crossing detector
  // compares pure DOM hit-tests, no PM state involved. The element may go
  // stale mid-gesture (the dispatch re-renders the table subtree) — that is
  // fine, the crossing latches on the first detection.
  const startCellEl = (startEvent.target as HTMLElement | null)?.closest?.(
    "td, th",
  ) as HTMLElement | null;
  const table = startCellEl ? cellTable(startCellEl) : null;
  let crossCell = false;

  /** A lost gesture must never leave the suppression engaged: the flag in
   *  cellDragFreeze blocks caret placement through filterTransaction until
   *  it is cleared (issue table-fast-selection-reset review round). */
  const guardDestroyed = (): boolean => {
    if (!view.isDestroyed) return false;
    stopSuppression();
    return true;
  };

  /**
   * The first move landing in a different cell (or off the table) latches
   * the crossing; every move of a crossed drag keeps the native text
   * selection machinery out: preventDefault drops the selection update the
   * move would perform, and the range of the in-cell prefix is cleared so
   * no text highlight survives into the rectangle drag.
   */
  const onMoveCapture = (event: MouseEvent): void => {
    if (guardDestroyed()) return;
    if (crossCell) {
      event.preventDefault();
      view.dom.ownerDocument.getSelection()?.removeAllRanges();
      return;
    }
    if (!startCellEl || !table) {
      return;
    }
    const cell = domCellAtPoint(table, event.clientX, event.clientY);
    if (cell === startCellEl) {
      return;
    }
    if (!cell) {
      // No cell under the pointer: only a pointer that left the table
      // counts (a hit-test miss inside the table is not a crossing).
      const rect = table.getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        return;
      }
    }
    crossCell = true;
    beginCrossCellDrag();
    doc.body.classList.add(CELL_DRAG_SELECT_CLASS);
    // The latching move itself would create a range in whatever content it
    // landed on (past the table edge — an ordinary paragraph): the default
    // selection update must not run for a crossed gesture.
    event.preventDefault();
    // The selection attempt(s) of the moves that stayed inside the starting
    // cell may have created a range already — the in-cell prefix of the
    // cross-cell gesture must not survive (owner invariant: no text
    // highlight at any moment of a cell-rectangle drag).
    view.dom.ownerDocument.getSelection()?.removeAllRanges();
  };

  /** Re-selection attempts of the native machinery never wanted now. */
  const onSelectStart = (event: Event): void => {
    if (guardDestroyed()) return;
    if (crossCell) {
      event.preventDefault();
    }
  };

  /**
   * Teardown of the text-selection suppression. Runs at the MOUSEUP (and on
   * blur / native dragstart — a drag of cell content releases the button
   * outside the document), not at the long-press abort: a fast drag leaves
   * the slop long before it ends, and the suppression must outlive the
   * abort — it protects the rectangle until the button is released. Latches
   * the flush window so the selectionchange following the range removal
   * cannot sync an empty DOM selection back over the fresh cell selection
   * (the same tail guard the hold path uses); a user click cannot
   * physically land within the window.
   */
  const stopSuppression = (): void => {
    doc.removeEventListener("mousemove", onMoveCapture, true);
    doc.removeEventListener("selectstart", onSelectStart, true);
    doc.removeEventListener("mouseup", onUp);
    window.removeEventListener("blur", onUp);
    doc.removeEventListener("dragstart", onUp);
    doc.body.classList.remove(CELL_DRAG_SELECT_CLASS);
    if (crossCell) {
      endCrossCellDrag();
      if (!view.isDestroyed && view.state.selection instanceof TextoCellSelection) {
        collapseLatchUntil = Date.now() + COLLAPSE_LATCH_MS;
      }
      // No text range may survive the gesture: clear whatever the browser
      // holds (the in-cell prefix or a late mouseup commit) — whether or not
      // a cell selection came out of it.
      view.dom.ownerDocument.getSelection()?.removeAllRanges();
    }
  };

  /**
   * Teardown of the long-press tracking (the abort paths and the end of a
   * hold). Does NOT touch the suppression listeners: a fast drag leaves the
   * slop long before the mouseup, and the suppression must outlive the
   * abort — it is torn down by onUp → stopSuppression.
   */
  const stop = (): void => {
    doc.removeEventListener("mousemove", onMove);
    window.clearTimeout(timer);
    if (!active) {
      return;
    }
    // The browser's mouseup commit (and the selectionchange flush it
    // triggers) may land AFTER the re-assert below — collapse-latch the
    // selection for a moment so no late flush can undo the hold. A user
    // click cannot physically happen within the window.
    collapseLatchUntil = Date.now() + COLLAPSE_LATCH_MS;
    if (!view.isDestroyed && view.state.selection instanceof TextoCellSelection) {
      view.focus();
      return;
    }
    // The hold had micro-movements within the slop: the browser's own text
    // selection drag (anchored at mousedown — mouse selection has no slop)
    // commits on mouseup and collapses the fresh cell selection to a caret.
    // Re-assert the cell selection once the default mouseup handling has
    // settled — after the hold, the cell stays selected (owner model).
    const anchorCell = anchor;
    window.setTimeout(() => {
      if (view.isDestroyed || !anchorCell) return;
      if (view.state.selection instanceof TextoCellSelection) return;
      view.dom.ownerDocument.getSelection()?.removeAllRanges();
      view.dispatch(view.state.tr.setSelection(new TextoCellSelection(anchorCell)));
      view.focus();
    }, 0);
  };

  const dispatchSelection = ($head: ResolvedPos): void => {
    if (!anchor || $head.pos === anchor.pos) {
      return;
    }
    // NO tableEditingKey meta here: prosemirror-tables' own mouse-drag
    // tracking is still active (our mousedown did not preventDefault) and
    // reads that state as a numeric anchor — a selection object in it
    // crashes its move handler. The two dispatches agree on the rectangle.
    view.dispatch(view.state.tr.setSelection(new TextoCellSelection(anchor, $head)));
  };

  const onMove = (event: MouseEvent): void => {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!active) {
      // Moved out of the slop before the timer: an ordinary drag — the
      // native rectangle selection handles it, the long-press is off.
      if (dx * dx + dy * dy > LONG_PRESS_SLOP * LONG_PRESS_SLOP) {
        stop();
      }
      return;
    }
    event.preventDefault();
    const $head = cellAtPoint(view, event.clientX, event.clientY);
    // The rectangle must not cross a table boundary: a head from another
    // table would build a selection with endpoints in different tables.
    if (!$head || !anchor || $head.node(-1) !== anchor.node(-1)) {
      return;
    }
    dispatchSelection($head);
  };

  /** Gesture end: the left button's mouseup — or a lost gesture (the
   *  window lost focus, or the content turned into a native drag and the
   *  mouseup lands outside the document). Secondary buttons must not tear
   *  down a running primary gesture (mirrors prosemirror-tables' own
   *  button check). */
  const onUp = (event: Event): void => {
    if (event.type === "mouseup" && (event as MouseEvent).button !== 0) {
      return;
    }
    stop();
    stopSuppression();
  };

  timer = window.setTimeout(() => {
    active = true;
    const $cell = cellAtPoint(view, startX, startY);
    if (!$cell) {
      stop();
      return;
    }
    anchor = $cell;
    // Micro-movements within the slop start a native text selection while
    // the button is held (mouse selection has no slop — any move selects).
    // Without this the text highlight sits on top of the fresh cell
    // selection and visually replaces it — the desktop twin of the mobile
    // reset (issue table-longpress-selection-reset). From here on the
    // selected cells are user-select: none (see the .selectedCell rule in
    // editor.css): text cannot be re-selected until the cell selection
    // collapses, exactly the owner's model — a plain click collapses it and
    // text selection works again.
    view.dom.ownerDocument.getSelection()?.removeAllRanges();
    view.dispatch(view.state.tr.setSelection(new TextoCellSelection($cell)));
  }, LONG_PRESS_MS);

  // The crossing guard runs in the CAPTURE phase, before prosemirror-tables'
  // move handler (view.root, bubble): the cleanup of the native range must
  // precede the rectangle dispatch, so the DOM selection ends the event in
  // the state PM just set.
  doc.addEventListener("mousemove", onMoveCapture, true);
  doc.addEventListener("selectstart", onSelectStart, true);
  doc.addEventListener("mousemove", onMove);
  doc.addEventListener("mouseup", onUp);
  // A lost mouseup must not leave the suppression engaged: the window losing
  // focus (alt-tab mid-drag) or the content turning into a native drag both
  // end the gesture without our mouseup.
  window.addEventListener("blur", onUp);
  doc.addEventListener("dragstart", onUp);
}
