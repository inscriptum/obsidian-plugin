import type { ResolvedPos } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import { tableEditingKey } from "prosemirror-tables";

import {
  beginCellDrag,
  endCellDrag,
  isCellDragActive,
  setPendingCellGestureCancel,
} from "./cellDragFreeze";
import { startColumnTouchResize } from "./columnTouchResize";
import { TextoCellSelection } from "./TextoCellSelection";

/** How long a finger must rest on a cell before cell selection starts. */
export const LONG_PRESS_MS = 450;

/** Double-tap window for the in-cell word selection (mobile twin of the
 *  desktop double-click): two taps within this time and this distance
 *  select the word under the finger. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 20;

/** Max finger movement (px) during the long-press that still counts as a press. */
export const LONG_PRESS_SLOP = 10;

/**
 * Body class added while a finger is down on a table cell. It disables
 * native text selection inside table cells so that the native long-press
 * text-selection gesture does not fight with the cell-selection gesture
 * (see the matching rule in mobile.css).
 */
const CELL_SELECTING_CLASS = "texto-table__cell-selecting";

/**
 * A temporary rectangle overlay showing the cells being picked by a
 * long-press drag.
 *
 * It lives on document.body (NOT inside the editor DOM, NOT as a class on ProseMirror-managed
 * td elements — PM reconciles element attributes and wipes foreign classes,
 * and NOT as a ProseMirror decoration — dispatching mid-gesture re-renders
 * the table subtree and destroys the element the finger went down on, after
 * which the WebView kills the whole touch/pointer stream; see
 * startLongPressCellSelection). The real TextoCellSelection is dispatched
 * once, on finger lift.
 */
const PICKING_RECT_CLASS = "texto-table__cell-picking-rect";

/**
 * Touch handler for tables on mobile (and touchscreens on desktop):
 * - touch on a resize handle (`.texto-table__resize-handle`) — column
 *   width drag-resize.
 * - touch on a cell — preventDefault'ed: the native WebView long-press
 *   machinery (word selection → context menu → touch-stream cancellation)
 *   must never see a touch that starts inside a cell. Evidence (2026-10-24,
 *   Android emulator, fresh page, guards active): the word under a
 *   stationary finger got selected ~540 ms after pointerdown despite
 *   user-select: none, and the resulting pointercancel killed the cell
 *   gesture right after its own activation — the "selection appears and
 *   immediately resets" report of issue table-longpress-selection-reset.
 *   Preventing the touchstart suppresses that machinery entirely (the same
 *   lever the old selection circle pulled), so taps get their caret from
 *   the synthesized compat events of the long-press gesture instead of the
 *   browser's (see dispatchTapCompatEvents in startLongPressCellSelection).
 *
 * Cell selection is the long-press gesture (startLongPressCellSelection,
 * below) — handled separately in handlePointerDown: see there for why it
 * runs on Pointer Events instead of touch events. The old circle drag this
 * file used to carry is gone (issue table-selection-native-drag).
 */
export function handleTouchStart(
  view: EditorView,
  startEvent: TouchEvent,
): boolean {
  const target = startEvent.target as HTMLElement | null;
  if (!target?.classList) {
    return false;
  }

  if (target.classList.contains("texto-table__resize-handle")) {
    return startColumnTouchResize(view, startEvent, target);
  }

  if (target.closest("td, th")) {
    startEvent.preventDefault();
  }

  return false;
}

/**
 * Pointer handler for the long-press cell selection (touch only).
 *
 * Why Pointer Events and not touch events: the pre-activation phase needs
 * reliable pointermove/pointerup to distinguish a tap from a press, and the
 * compatibility mouse events of a tap must stay enabled. The gesture itself
 * stays dispatch-free (see PICKING_RECT_CLASS) so the touched element survives —
 * that is what keeps the input stream alive until the finger lifts.
 */
export function handlePointerDown(
  view: EditorView,
  event: PointerEvent,
): boolean {
  if (event.pointerType !== "touch" || !event.isPrimary) {
    return false;
  }

  const target = event.target as HTMLElement | null;
  if (!target?.classList) {
    return false;
  }

  // The resize handles have their own touch-based gesture.
  if (target.classList.contains("texto-table__resize-handle")) {
    return false;
  }

  const startCellEl = target.closest("td, th");
  if (!startCellEl) {
    return false;
  }

  return startLongPressCellSelection(view, event, startCellEl as HTMLElement);
}

function cellPosFromDom(
  view: EditorView,
  cellEl: HTMLElement,
): ResolvedPos | null {
  try {
    const $inner = view.state.doc.resolve(view.posAtDOM(cellEl, 0));
    for (let depth = $inner.depth; depth > 0; depth -= 1) {
      // .spec is untyped (any) in prosemirror-model — cast explicitly.
      const role = $inner.node(depth).type.spec.tableRole as string | undefined;
      if (role === "cell" || role === "header_cell") {
        return view.state.doc.resolve($inner.before(depth));
      }
    }
  } catch {
    // The element may be detached (stale gesture) — no position then.
  }
  return null;
}

function dispatchCellSelection(
  view: EditorView,
  $anchor: ResolvedPos,
  $head: ResolvedPos,
): void {
  const selection = new TextoCellSelection($anchor, $head);
  view.dispatch(
    view.state.tr.setSelection(selection).setMeta(tableEditingKey, selection),
  );
}

function cellTable(cell: HTMLElement): HTMLTableElement | null {
  const wrapper = cell.closest(".table-wrapper");
  const table = wrapper?.querySelector("table") ?? cell.closest("table");
  return table instanceof HTMLTableElement &&
    table.getBoundingClientRect().width > 0
    ? table
    : null;
}

/**
 * The td/th whose rect contains the point. Pure DOM hit-testing — does not
 * depend on elementFromPoint (workspace-drawer-backdrop can swallow it on
 * mobile) or on ProseMirror state.
 */
function domCellAtPoint(
  table: HTMLTableElement | null,
  x: number,
  y: number,
): HTMLElement | null {
  if (!table) {
    return null;
  }

  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) {
      const rect = cell.getBoundingClientRect();
      if (
        rect.width > 0 &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return cell;
      }
    }
  }
  return null;
}

/** Highlights the rectangle of cells from anchor to head (direct DOM). */
function redrawPicked(
  anchor: HTMLElement | null,
  head: HTMLElement | null,
): HTMLElement | null {
  let rect = document.querySelector<HTMLElement>(
    ":scope > body > ." + PICKING_RECT_CLASS,
  );
  if (!anchor) {
    rect?.remove();
    return null;
  }

  if (!rect) {
    rect = createDiv(PICKING_RECT_CLASS);
    // The rect MUST live outside the editor DOM: ProseMirror observes the
    // editor subtree, and a foreign node inside the table wrapper would be
    // reconciled with a document transaction, changing view.state.doc
    // mid-gesture and invalidating the resolved cell positions.
    document.body.appendChild(rect);
  }

  const a = anchor.getBoundingClientRect();
  const h = head?.getBoundingClientRect() ?? a;
  const left = Math.min(a.left, h.left);
  const top = Math.min(a.top, h.top);
  const right = Math.max(a.right, h.right);
  const bottom = Math.max(a.bottom, h.bottom);
  rect.setAttribute(
    "style",
    `display:block; left:${left.toFixed(1)}px; top:${top.toFixed(1)}px; width:${(right - left).toFixed(1)}px; height:${(bottom - top).toFixed(1)}px;`,
  );
  return rect;
}

/**
 * Long-press on a table cell starts cell selection: after LONG_PRESS_MS with
 * the finger within LONG_PRESS_SLOP, the cell under the touch becomes the
 * selection anchor; dragging highlights the rectangle (direct DOM classes,
 * no ProseMirror dispatch — see PICKING_RECT_CLASS) and on finger lift the real
 * TextoCellSelection is dispatched once.
 */
function startLongPressCellSelection(
  view: EditorView,
  event: PointerEvent,
  startCell: HTMLElement,
): boolean {
  const startX = event.clientX;
  const startY = event.clientY;
  const pointerId = event.pointerId;
  // prosemirror-view types EditorView.dom as HTMLElement — no assertion needed.
  const viewDom = view.dom;
  const root = viewDom.ownerDocument;
  const body = root.body;
  let timer = 0;
  // The anchor position is resolved SYNCHRONOUSLY, while the touched cell is
  // still attached: right after the pointerdown Obsidian tags the cell with
  // its own `mobile-tap` class, ProseMirror reconciles the foreign attribute
  // mutation by re-rendering the cell, and the element this gesture started
  // on becomes detached (its position can no longer be mapped through it).
  // Doc positions survive that re-render (the document does not change), so
  // the resolved anchor stays valid for the whole gesture.
  const $anchor = cellPosFromDom(view, startCell);
  let anchorDom: HTMLElement | null = null;
  let headDom: HTMLElement | null = null;
  let lastX = startX;
  let lastY = startY;

  function clearPicked(): void {
    redrawPicked(null, null);
    anchorDom = null;
    headDom = null;
  }

  function unbindDrag(): void {
    viewDom.removeEventListener("pointermove", dragMove);
    viewDom.removeEventListener("pointerup", dragEnd);
    viewDom.removeEventListener("pointercancel", dragCancel);
  }

  function cleanup(): void {
    window.clearTimeout(timer);
    viewDom.removeEventListener("pointermove", onMove);
    viewDom.removeEventListener("pointerup", onUp);
    viewDom.removeEventListener("pointercancel", onCancel);
    body.classList.remove(CELL_SELECTING_CLASS);
    clearPicked();
  }

  function activate(): void {
    // Pre-activation listeners are replaced by the drag ones.
    viewDom.removeEventListener("pointermove", onMove);
    viewDom.removeEventListener("pointerup", onUp);
    viewDom.removeEventListener("pointercancel", onCancel);
    // The lost-pointerup backstop guards the pending-timer window only;
    // the drag phase ends through its own dragEnd/dragCancel.
    viewDom.removeEventListener("touchend", onTouchEnd);
    viewDom.removeEventListener("touchcancel", onTouchEnd);
    window.clearTimeout(timer);

    anchorDom = startCell.isConnected
      ? startCell
      : (document
          .elementFromPoint(startX, startY)
          ?.closest("td, th") as HTMLElement | null);

    if (!$anchor) {
      cleanup();
      return;
    }

    beginCellDrag();

    // Light haptic feedback that the long-press was recognized.
    navigator.vibrate?.(10);

    redrawPicked(anchorDom, null);
    viewDom.addEventListener("pointermove", dragMove);
    viewDom.addEventListener("pointerup", dragEnd);
    viewDom.addEventListener("pointercancel", dragCancel);
  }

  function dragMove(event: PointerEvent): void {
    if (!anchorDom) {
      return;
    }
    lastX = event.clientX;
    lastY = event.clientY;
    const cell = domCellAtPoint(cellTable(anchorDom), lastX, lastY);
    if (cell !== headDom) {
      headDom = cell;
      redrawPicked(anchorDom, headDom);
    }
  }

  function dragEnd(): void {
    unbindDrag();

    if ($anchor) {
      const $head = (headDom ? cellPosFromDom(view, headDom) : null) ?? $anchor;

      dispatchCellSelection(view, $anchor, $head);
    }

    endCellDrag();
    cleanup();
    if (tableEditingKey.getState(view.state) != null) {
      view.dispatch(view.state.tr.setMeta(tableEditingKey, -1));
    }
  }

  function dragCancel(): void {
    // The browser took the gesture away (e.g. native scroll): nothing was
    // dispatched, so just tear everything down.
    unbindDrag();
    endCellDrag();
    cleanup();
  }

  function onMove(event: PointerEvent): void {
    // A secondary finger must not turn the primary gesture into scrolling.
    if (event.pointerId !== pointerId) {
      return;
    }
    // The finger moved too far: this is scrolling, not a long press.
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (dx * dx + dy * dy > LONG_PRESS_SLOP * LONG_PRESS_SLOP) {
      startManualScroll(event);
    }
  }

  /**
   * Cells own their touches (touch-action: none, see mobile.css): the
   * browser never takes the gesture for scrolling, so a swipe that starts on
   * a cell must scroll the document manually until the finger lifts.
   */
  function startManualScroll(event: PointerEvent): void {
    window.clearTimeout(timer);
    viewDom.removeEventListener("pointermove", onMove);
    viewDom.removeEventListener("pointerup", onUp);
    viewDom.removeEventListener("pointercancel", onCancel);
    // The press became a scroll: no tap to replay on touchend, and the
    // lost-pointerup backstop has nothing to guard anymore.
    gestureCancelled = true;
    viewDom.removeEventListener("touchend", onTouchEnd);
    viewDom.removeEventListener("touchcancel", onTouchEnd);
    body.classList.remove(CELL_SELECTING_CLASS);

    let lastX = event.clientX;
    let lastY = event.clientY;
    // startCell comes from target.closest("td, th") of THIS document — no
    // cross-realm caveat, so plain parameter passing beats the Obsidian
    // .instanceOf polyfill (whose absence would throw mid-gesture and kill
    // the scroll emulation silently).
    const scroller = findScrollParent(startCell);
    // The table wrapper scrolls the columns: cells own their touches
    // (touch-action: none), so a horizontal swipe reveals off-screen
    // columns only through this emulation. Natural direction: the content
    // follows the finger.
    const wrapper = findScrollParentX(startCell);

    const scrollMove = (e: PointerEvent) => {
      if (wrapper) {
        wrapper.scrollLeft -= e.clientX - lastX;
      }
      if (scroller) {
        scroller.scrollTop -= e.clientY - lastY;
      }
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const scrollEnd = () => {
      viewDom.removeEventListener("pointermove", scrollMove);
      viewDom.removeEventListener("pointerup", scrollEnd);
      viewDom.removeEventListener("pointercancel", scrollEnd);
    };
    viewDom.addEventListener("pointermove", scrollMove);
    viewDom.addEventListener("pointerup", scrollEnd);
    viewDom.addEventListener("pointercancel", scrollEnd);
  }

  // The tap of THIS gesture was replayed (or is about to be); a touchend
  // after it must not replay anything. Also set when the gesture was taken
  // away (pointercancel) — there is no tap to replay then either.
  let tapHandled = false;
  let gestureCancelled = false;
  const isDoubleTap = isDoubleTapAt(startX, startY);

  function onUp(event: PointerEvent): void {
    // A secondary finger's lift must not place a caret at its own point.
    if (event.pointerId !== pointerId) {
      return;
    }
    // Released before the timer fired: a regular tap (or the second tap of
    // a double-tap → word selection, the mobile twin of the desktop
    // double-click).
    tapHandled = true;
    const double = isDoubleTap;
    registerTap(startX, startY);
    cleanup();
    dispatchTapCompatEvents(event.clientX, event.clientY, double);
  }

  /** Gesture taken away pre-activation: plain teardown, no tap to replay. */
  function onCancel(): void {
    gestureCancelled = true;
    cleanup();
  }

  /**
   * Replays the compatibility mouse sequence (mousedown → mouseup → click)
   * of a tap. The real sequence is suppressed — handleTouchStart preventDefaults
   * the touchstart on cells to keep the native long-press machinery out — so
   * link clicks (clickHandler), checkbox toggles and other DOM click handlers
   * are driven by these events instead.
   *
   * The caret cannot be left to that sequence: on a trusted click the
   * BROWSER moves the native selection (ProseMirror only syncs it), and a
   * synthetic event never does. So the caret is set through the editor
   * explicitly — and focus() with it, which is what raises the keyboard.
   */
  function dispatchTapCompatEvents(x: number, y: number, wordSelect = false): void {
    const target =
      document.elementFromPoint(x, y) ?? (startCell.isConnected ? startCell : viewDom);
    const mouseInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      clientX: x,
      clientY: y,
    };
    target.dispatchEvent(
      new MouseEvent("mousedown", { ...mouseInit, buttons: 1, detail: 1 }),
    );
    target.dispatchEvent(
      new MouseEvent("mouseup", { ...mouseInit, buttons: 0, detail: 1 }),
    );
    target.dispatchEvent(
      new MouseEvent("click", { ...mouseInit, buttons: 0, detail: 1 }),
    );

    const pos = view.posAtCoords({ left: x, top: y });
    if (pos) {
      view.focus();
      const $pos = view.state.doc.resolve(pos.pos);
      if (wordSelect) {
        // Second tap of a double-tap: select the word under the finger —
        // the native long-press word selection is suppressed on cells, so
        // this is the mobile text-selection affordance (owner model: text
        // selection stays available until a long-press selects the cell).
        const range = wordRangeAt(view, $pos);
        if (range) {
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(view.state.doc, range.from, range.to))
              .setMeta("pointer", true),
          );
          return;
        }
      }
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.near($pos))
          .setMeta("pointer", true),
      );
    }
  }

  // Capture the pointer on view.dom so the move/up events keep coming even
  // if the touched element is replaced from under the finger.
  try {
    viewDom.setPointerCapture(pointerId);
  } catch {
    // Synthetic or already-finished pointer — implicit capture still works.
  }

  // user-select: none keeps the native text-selection long-press from
  // engaging while the finger is down (see the rule in mobile.css).
  body.classList.add(CELL_SELECTING_CLASS);
  viewDom.addEventListener("pointermove", onMove);
  viewDom.addEventListener("pointerup", onUp);
  viewDom.addEventListener("pointercancel", onCancel);
  // Backstop for a lost pointerup (the touched cell can be re-rendered away
  // by the mobile-tap reconciliation): the native touch stream still ends
  // with touchend even though the touchstart was prevented. Without the
  // pointerup there are no compat events and no caret — replay the tap from
  // the gesture origin here. The backstop guards only the pre-activation
  // window: activate() unbinds it when the drag phase takes over.
  const onTouchEnd = (event: TouchEvent) => {
    if (event.type === "touchcancel") {
      gestureCancelled = true;
      viewDom.removeEventListener("touchend", onTouchEnd);
      viewDom.removeEventListener("touchcancel", onTouchEnd);
      return;
    }
    // A secondary finger's touchend must not replay the primary's tap
    // (Chromium: a touch pointer's pointerId equals its touch identifier).
    const ours = Array.from(event.changedTouches).some(
      (t) => t.identifier === pointerId,
    );
    if (!ours) {
      return;
    }
    viewDom.removeEventListener("touchend", onTouchEnd);
    viewDom.removeEventListener("touchcancel", onTouchEnd);
    if (!tapHandled && !gestureCancelled) {
      cleanup();
      dispatchTapCompatEvents(startX, startY);
    }
  };
  viewDom.addEventListener("touchend", onTouchEnd);
  viewDom.addEventListener("touchcancel", onTouchEnd);
  timer = window.setTimeout(activate, LONG_PRESS_MS);
  // If the pointerup of this tap is lost (the touched cell can be re-rendered
  // away by the mobile-tap reconciliation), the pending timer would still
  // fire and turn a plain tap into a cell selection. A compatibility
  // mousedown proves the finger has lifted — cancel the timer then (see
  // cellDragFreeze.cancelPendingCellGesture).
  setPendingCellGestureCancel(cleanup);
  return true;
}

/**
 * The nearest ancestor of the cell that scrolls HORIZONTALLY (the
 * .table-wrapper on a phone: columns wider than the screen).
 */
function findScrollParentX(startCell: HTMLElement | null): HTMLElement | null {
  let el = startCell?.parentElement ?? null;
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === "auto" || overflow === "scroll") {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * The nearest ancestor of the cell that actually scrolls (the note scroller).
 */
function findScrollParent(startCell: HTMLElement | null): HTMLElement | null {
  let el = startCell?.parentElement ?? null;
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Non-passive touchmove guard on view.dom: once a cell-selection drag is
 * active, every touchmove must be prevented, otherwise the still-alive touch
 * stream turns the drag into document scrolling. Before the gesture starts
 * (and for ordinary taps and scrolls) this listener does nothing.
 */
export function handleTouchMoveDuringDrag(event: TouchEvent): void {
  if (isCellDragActive()) {
    event.preventDefault();
  }
}


/** Word boundaries around a resolved position (null when not in text).
 *  Mirrors the desktop double-click: letters/digits/underscore count as
 *  word characters, everything else separates. */
function wordRangeAt(
  view: EditorView,
  $pos: ResolvedPos,
): { from: number; to: number } | null {
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  const child = parent.childAfter($pos.parentOffset);
  const textNode = child.node;
  if (!textNode?.isText || typeof textNode.text !== "string") return null;
  const text = textNode.text;
  const rel = $pos.parentOffset - child.offset;
  const isWord = (ch: string | undefined) => ch != null && /\p{L}\p{N}_/u.test(ch);
  let from = rel;
  let to = rel;
  while (from > 0 && isWord(text[from - 1])) from -= 1;
  while (to < text.length && isWord(text[to])) to += 1;
  if (from === to) return null;
  const nodeStart = $pos.start() + child.offset;
  return { from: nodeStart + from, to: nodeStart + to };
}

/** Double-tap memory (module scope: taps outlive one gesture). */
let lastTap: { at: number; x: number; y: number } | null = null;

function isDoubleTapAt(x: number, y: number): boolean {
  if (lastTap == null) return false;
  const dx = x - lastTap.x;
  const dy = y - lastTap.y;
  return (
    Date.now() - lastTap.at <= DOUBLE_TAP_MS &&
    dx * dx + dy * dy <= DOUBLE_TAP_SLOP * DOUBLE_TAP_SLOP
  );
}

function registerTap(x: number, y: number): void {
  lastTap = { at: Date.now(), x, y };
}
