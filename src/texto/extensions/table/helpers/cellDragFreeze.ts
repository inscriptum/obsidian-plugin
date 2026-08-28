import type {EditorState} from 'prosemirror-state';
import type {Decoration} from 'prosemirror-view';

import {buildSelectionOverlayDecoration, overlayTableKey} from './overlay';

// The last overlay decoration handed out by overlayForDraw.
let lastOverlay: Decoration | null = null;

// The table node the last overlay belongs to (compared by identity). A frozen
// overlay is only reused while the selection stays within the same table — a
// long-press may start in a different table than the one the caret was in, and
// the overlay element must live inside that table's DOM for absolute
// positioning to work.
let lastOverlayTableKey: object | null = null;

let dragActive = false;

/**
 * Suppression window for the synthetic compatibility mouse events
 * (mousedown/mouseup/click) that Android dispatches right after a touch cell
 * drag ends.
 *
 * Why a window instead of a touchend-based grace: on Android the synthetic
 * `touchend` is not reliably delivered to our document listener (the WebView
 * cancels the touch once the long-press gesture takes over), so a
 * touchend-keyed grace never opens and the compat mousedown collapses the
 * freshly built TextoCellSelection back to a caret. The circle drag avoids
 * this only because it calls preventDefault() on touchstart, which suppresses
 * the compat events entirely — the long-press gesture must not preventDefault
 * touchstart (otherwise a plain tap could no longer place the caret for
 * editing), so we suppress the compat mouse events here instead.
 *
 * The window opens when the gesture starts (beginCellDrag) and is renewed on
 * a bounded grace when the gesture ends (endCellDrag), covering the compat
 * events that arrive right after the finger lifts. Consuming the first
 * synthetic mousedown narrows the window to cover just the following
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
 * The overlay decoration for the current draw.
 *
 * Why the freeze: during a drag the selection changes on every touchmove, and
 * without this trick ProseMirror would recreate the widget decoration and the
 * circle DOM node (the touch target). Removing the touch target in the middle
 * of a touch makes the browser cancel the gesture (touchcancel) — the smooth
 * drag died after its first move. By returning the frozen (same) instance the
 * circle DOM node stays alive for the whole gesture; its position is updated
 * in place by refreshOverlayPosition.
 *
 * The frozen instance is only reused while the selection stays within the
 * same table (see lastOverlayTableKey); otherwise a fresh overlay is built.
 */
export function overlayForDraw(state: EditorState): Decoration | null {
	if (dragActive && lastOverlay && lastOverlayTableKey === overlayTableKey(state)) {
		return lastOverlay;
	}

	lastOverlay = buildSelectionOverlayDecoration(state);
	lastOverlayTableKey = overlayTableKey(state);
	return lastOverlay;
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
