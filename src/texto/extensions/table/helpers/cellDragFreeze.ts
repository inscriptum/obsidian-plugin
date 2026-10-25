let dragActive = false;

/**
 * Suppression window for the compatibility mouse events
 * (mousedown/mouseup/click) that a WebView dispatches after a touch ends.
 *
 * Since issue table-longpress-selection-reset, touches that start on a cell
 * are preventDefault'ed (handleTouchStart), so the browser does not
 * synthesize compat events for them at all — a cell gesture replays its own
 * tap events instead. The window still guards the freshly built
 * TextoCellSelection against compat events of OTHER touch sequences that end
 * right after a drag (e.g. a second finger down elsewhere on the page): a
 * stray mousedown would collapse the cell selection back to a text cursor.
 * The window opens when the gesture starts (beginCellDrag) and is renewed on
 * a bounded grace when the gesture ends (endCellDrag). Consuming the first
 * stray mousedown narrows the window to cover just the following
 * mouseup/click. The window always expires on its own, so no legitimate
 * later tap is ever swallowed.
 */
let touchCompatSuppressUntil = 0;

/** Grace that covers the compatibility mouse events after a gesture ends. */
const TOUCH_COMPAT_GRACE_MS = 400;

/** Start of a cell drag gesture: freeze the overlay and open the suppress window. */
export function beginCellDrag(): void {
  dragActive = true;
  touchCompatSuppressUntil = Number.MAX_SAFE_INTEGER;
}

/** End of a cell drag: the overlay follows the selection again. */
export function endCellDrag(): void {
  dragActive = false;
  // The gesture is over, but the compatibility mouse events of the touch may
  // still arrive (they are only guaranteed absent when the touchstart was
  // preventDefault'ed, like in the circle drag). Keep the suppression window
  // open for a short grace that covers them; it expires on its own, so a
  // later legitimate tap is never swallowed.
  touchCompatSuppressUntil = Date.now() + TOUCH_COMPAT_GRACE_MS;
}

/** Whether a cell drag gesture is currently running. */
export function isCellDragActive(): boolean {
  return dragActive;
}

/**
 * Whether a synthetic compatibility mouse event from a just-finished touch
 * cell drag should be swallowed (see handleMouseDown).
 */
export function isTouchCompatMouseSuppressed(): boolean {
  return Date.now() < touchCompatSuppressUntil;
}

/**
 * Mark the first synthetic mouse event of the sequence as consumed, closing
 * the window after a short grace (covers the following mouseup/click).
 */
export function consumeTouchCompatMouse(): void {
  touchCompatSuppressUntil = Date.now() + TOUCH_COMPAT_GRACE_MS;
}

/**
 * Hook for cancelling a pending (not yet activated) long-press cell gesture.
 *
 * A compatibility mousedown is only dispatched after the finger has lifted,
 * so when handleMouseDown sees one it can safely cancel the long-press timer:
 * the finger is gone, the gesture can no longer be a long press. This rescues
 * plain taps whose pointerup was lost to a mid-gesture DOM reconciliation.
 */
let pendingGestureCancel: (() => void) | null = null;

export function setPendingCellGestureCancel(fn: (() => void) | null): void {
  pendingGestureCancel = fn;
}

export function cancelPendingCellGesture(): void {
  const fn = pendingGestureCancel;
  pendingGestureCancel = null;
  fn?.();
}
