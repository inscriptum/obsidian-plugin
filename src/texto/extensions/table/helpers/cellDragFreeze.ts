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
let dragEndedAt = 0;

/**
 * Grace window after a touch cell drag during which the synthetic mousedown
 * (dispatched by the browser right after touchend) is swallowed. Otherwise it
 * would collapse the freshly built cell selection back to a text cursor.
 */
const DRAG_END_GRACE_MS = 200;

/** Start of a cell drag gesture: freeze the overlay (reuse the same instance). */
export function beginCellDrag(): void {
	dragActive = true;
}

/** End of a cell drag: the overlay follows the selection again. */
export function endCellDrag(): void {
	dragActive = false;
	dragEndedAt = Date.now();
}

/** Whether a cell drag gesture is currently running. */
export function isCellDragActive(): boolean {
	return dragActive;
}

/**
 * Whether the synthetic mousedown that follows a just-ended touch drag should
 * be swallowed (see handleMouseDown).
 */
export function isJustAfterCellDrag(): boolean {
	return Date.now() - dragEndedAt < DRAG_END_GRACE_MS;
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
