import type {ResolvedPos} from 'prosemirror-model';
import type {EditorView} from 'prosemirror-view';
import {tableEditingKey} from 'prosemirror-tables';

import {beginCellDrag, endCellDrag} from './cellDragFreeze';
import {startColumnTouchResize} from './columnTouchResize';
import {cellAtPoint, cellInTableAtPoint} from './handleMouseDown';
import {scheduleOverlayRefresh} from './overlay';
import {TextoCellSelection} from './TextoCellSelection';

/** Clearance for the first move of a circle drag — see handleMouseDown.ts. */
const CIRCLE_CLEARANCE = 18;

/** How long a finger must rest on a cell before cell selection starts. */
const LONG_PRESS_MS = 450;

/** Max finger movement (px) during the long-press that still counts as a press. */
const LONG_PRESS_SLOP = 10;

/**
 * Body class added while a finger is down on a table cell. It disables
 * native text selection inside table cells so that the native long-press
 * text-selection gesture does not fight with the cell-selection gesture
 * (see the matching rule in mobile.css).
 */
const CELL_SELECTING_CLASS = 'texto-table__cell-selecting';

/**
 * Touch handler for tables on mobile (and touchscreens on desktop):
 * - touch on the selection circle (`.texto-table__overlay_overlay-circle`) —
 *   drag cell selection, the touch counterpart of the mouse gesture;
 * - long-press on a table cell — start cell selection from that cell and
 *   extend it by dragging, same as on desktop;
 * - touch on a resize handle (`.texto-table__resize-handle`) — column
 *   width drag-resize.
 *
 * All other touches pass through (cursor placement / editing via compat
 * mouse events).
 */
export function handleTouchStart(view: EditorView, startEvent: TouchEvent): boolean {
	const target = startEvent.target as HTMLElement | null;
	if (!target?.classList) {
		return false;
	}

	if (target.classList.contains('texto-table__resize-handle')) {
		return startColumnTouchResize(view, startEvent, target);
	}

	// classList instead of an exact className match: Obsidian may add its own
	// classes to the element (e.g. mobile-tap).
	if (target.classList.contains('texto-table__overlay_overlay-circle')) {
		if (startEvent.touches.length !== 1) {
			return false;
		}

		beginCellDrag();

		// The anchor cell position is recorded by the decoration in the
		// circle's data-cell-pos — this is more reliable than geometry:
		// posAtCoords can degrade on mobile (workspace-drawer-backdrop).
		runCellDrag(view, startEvent, Number(target.dataset.cellPos) || null, CIRCLE_CLEARANCE);
		startEvent.preventDefault();
		return true;
	}

	// A touch that landed inside a table cell (but not on the circle or a
	// resize handle) may become a long-press cell selection.
	const cell = target.closest('td, th');
	if (cell) {
		return startLongPressCellSelection(view, startEvent);
	}

	return false;
}

/**
 * Shared touch drag for cell selection: touchmove builds a TextoCellSelection
 * from the anchor cell to the cell under the finger.
 *
 * The overlay decoration is frozen for the whole gesture (beginCellDrag) so
 * ProseMirror reuses the circle DOM node instead of recreating it — removing
 * the touch target mid-gesture makes the browser cancel the touch
 * (touchcancel), which killed the drag after its first move.
 */
function runCellDrag(
	view: EditorView,
	startEvent: TouchEvent,
	anchorPos: number | null,
	clearance: number,
): void {
	let topLeftAnchor = anchorPos;
	let isFirstMove = true;

	function point(event: TouchEvent) {
		return event.touches[0] ?? event.changedTouches[0];
	}

	function setCellSelection($anchor: ResolvedPos | null, event: TouchEvent) {
		if (!$anchor) return;

		const touch = point(event);
		const $head =
			cellAtPoint(view, touch.clientX, touch.clientY, isFirstMove ? clearance : 0) ??
			cellInTableAtPoint(view, topLeftAnchor ?? $anchor.pos, touch.clientX, touch.clientY);
		isFirstMove = false;
		if (!$head) return;

		if (topLeftAnchor == null) {
			topLeftAnchor = $anchor.pos;
		}

		const selection = new TextoCellSelection($anchor, $head);
		view.dispatch(view.state.tr.setSelection(selection).setMeta(tableEditingKey, selection));
		scheduleOverlayRefresh(view);
	}

	function stop(event: TouchEvent) {
		endCellDrag();
		root.removeEventListener('touchmove', move);
		root.removeEventListener('touchend', end);
		root.removeEventListener('touchcancel', stop);
		document.body.classList.remove(CELL_SELECTING_CLASS);
		// Suppress the synthetic click: it would collapse the freshly built
		// cell selection back to a text cursor.
		event.preventDefault();
		if (tableEditingKey.getState(view.state) != null) {
			view.dispatch(view.state.tr.setMeta(tableEditingKey, -1));
		}
	}

	function end(event: TouchEvent) {
		stop(event);
	}

	function move(event: TouchEvent) {
		// Keep the drag from turning into document scrolling.
		event.preventDefault();

		const start = point(startEvent);
		const $anchor =
			topLeftAnchor != null
				? view.state.doc.resolve(topLeftAnchor)
				: cellAtPoint(view, start.clientX, start.clientY, isFirstMove ? clearance : 0);
		setCellSelection($anchor, event);
	}

	const root = view.dom.ownerDocument;
	root.addEventListener('touchmove', move, {passive: false});
	root.addEventListener('touchend', end);
	root.addEventListener('touchcancel', stop);
}

/**
 * Long-press on a table cell starts cell selection: after LONG_PRESS_MS with
 * the finger within LONG_PRESS_SLOP, the cell under the touch becomes the
 * selection anchor and a drag gesture runs until the finger lifts.
 *
 * The initial touch is deliberately NOT prevented: normal taps must keep
 * working (ProseMirror places the cursor from the synthetic mouse events)
 * and small finger movements must keep scrolling the document. Only when the
 * long-press fires do we take the gesture over.
 */
function startLongPressCellSelection(view: EditorView, startEvent: TouchEvent): boolean {
	if (startEvent.touches.length !== 1) {
		return false;
	}

	const touch = startEvent.touches[0];
	const startX = touch.clientX;
	const startY = touch.clientY;
	const root = view.dom.ownerDocument;
	const body = root.body;
	let timer = 0;

	function cleanup() {
		window.clearTimeout(timer);
		root.removeEventListener('touchmove', onMove);
		root.removeEventListener('touchend', onEnd);
		root.removeEventListener('touchcancel', onEnd);
		body.classList.remove(CELL_SELECTING_CLASS);
	}

	function activate() {
		cleanup();
		if (startEvent.touches.length !== 1) {
			return;
		}

		// Native long-press text selection may have engaged already: drop it
		// so it does not fight with the cell selection overlay.
		root.getSelection()?.removeAllRanges();

		const $anchor = cellAtPoint(view, startX, startY);
		if (!$anchor) {
			return;
		}

		beginCellDrag();

		// Light haptic feedback that the long-press was recognized.
		navigator.vibrate?.(10);

		const selection = new TextoCellSelection($anchor);
		view.dispatch(view.state.tr.setSelection(selection).setMeta(tableEditingKey, selection));
		scheduleOverlayRefresh(view);

		// The finger is already inside the anchor cell, so no clearance is
		// needed (unlike the circle drag, where it stands on the corner).
		runCellDrag(view, startEvent, $anchor.pos, 0);
	}

	function onMove(event: TouchEvent) {
		const current = event.touches[0];
		if (!current) {
			return;
		}

		const dx = current.clientX - startX;
		const dy = current.clientY - startY;

		// The finger moved too far: this is scrolling, not a long press.
		if (dx * dx + dy * dy > LONG_PRESS_SLOP * LONG_PRESS_SLOP) {
			cleanup();
		}
	}

	function onEnd() {
		// Released before the timer fired: a regular tap.
		cleanup();
	}

	// user-select: none keeps the native text-selection long-press from
	// engaging while the finger is down (see the rule in mobile.css). The
	// class is kept until the gesture fully ends — runCellDrag's stop()
	// removes it too, so it survives past activation into the drag.
	body.classList.add(CELL_SELECTING_CLASS);
	root.addEventListener('touchmove', onMove);
	root.addEventListener('touchend', onEnd);
	root.addEventListener('touchcancel', onEnd);
	timer = window.setTimeout(activate, LONG_PRESS_MS);
	return true;
}
