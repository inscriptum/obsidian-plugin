import type {ResolvedPos} from 'prosemirror-model';
import type {EditorView} from 'prosemirror-view';
import {tableEditingKey, TableMap} from 'prosemirror-tables';

import {beginCellDrag, cancelPendingCellGesture, consumeTouchCompatMouse, endCellDrag, isTouchCompatMouseSuppressed} from './cellDragFreeze';
import {scheduleOverlayRefresh} from './overlay';
import {TextoCellSelection} from './TextoCellSelection';

/**
 * Shift of the point up-left on the first move of a drag: the pointer stands
 * on the selection circle (in the corner of a cell, on top of the content and
 * outside the document tree).
 * The circle has a touch zone enlarged by 10px (::before, inset: -10px,
 * see mobile.css), so the clearance must exceed it.
 *
 * On narrow columns (phone) a fixed shift can throw the point outside the
 * cell, so the point is taken with a progressively decreasing shift — until
 * the first hit inside a cell (see cellAtPoint).
 */
const CIRCLE_CLEARANCE = 18;

/** Fractions of the clearance tried in cellAtPoint. */
const CLEARANCE_STEPS = [1, 0.66, 0.33, 0] as const;

/**
 * The cell containing the position (including the cell level itself).
 *
 * Unlike cellAround from prosemirror-tables, which starts walking up from
 * depth − 1, this also takes the cell level itself into account: posAtCoords
 * may return a position exactly on the border of the cell content — for
 * example, the position of the resize-handle widget (on the phone the handles
 * overlap parts of the cells).
 */
function cellContaining($pos: ResolvedPos): ResolvedPos | null {
	for (let depth = $pos.depth; depth > 0; depth -= 1) {
		const role = $pos.node(depth).type.spec.tableRole;
		if (role === 'cell' || role === 'header_cell') {
			return $pos.doc.resolve($pos.before(depth));
		}
	}
	return null;
}

/**
 * Finds the cell under the given screen point.
 *
 * `offset` shifts the point up-left: used on the first move of a drag,
 * when the pointer stands on the selection circle (in the corner of a cell)
 * and must be moved inside the anchor cell. If the full shift throws the
 * point outside the cell (narrow column on the phone), the shift decreases
 * step by step.
 */
export function cellAtPoint(view: EditorView, clientX: number, clientY: number, offset = 0) {
	for (const step of CLEARANCE_STEPS) {
		const shift = Math.round(offset * step);
		const x = clientX - shift;
		const y = clientY - shift;

		// Points on the selection overlay (the circle and its enlarged touch
		// zone) are not resolved: posAtCoords would return the widget position,
		// which collapses head into the anchor cell and blocks the growth of
		// the selection rect.
		const hit = view.dom.ownerDocument.elementFromPoint(x, y);
		if (hit?.closest('.texto-table__overlay')) continue;

		const pos = view.posAtCoords({left: x, top: y});
		if (!pos) continue;

		const $pos = view.state.doc.resolve(pos.pos);
		const cell = $pos.nodeAfter;
		if (cell && (cell.type.name === 'tableCell' || cell.type.name === 'tableHeader')) return $pos;

		// posAtCoords usually points inside the paragraph text or on the border
		// of the cell content — walk up the hierarchy to the cell.
		const around = cellContaining($pos);
		if (around) return around;
	}
	return null;
}

/**
 * The cell of the anchor cell's table whose rect contains the point.
 *
 * The rect-based DOM lookup does not use elementFromPoint, so it works even
 * when workspace-drawer-backdrop (the mobile drawer backdrop of Obsidian)
 * intercepts hit-testing and posAtCoords degrades. Used as a fallback for
 * the head cell during drag selection.
 */
export function cellInTableAtPoint(
	view: EditorView,
	anchorCellPos: number,
	clientX: number,
	clientY: number,
): ResolvedPos | null {
	const $anchor = view.state.doc.resolve(anchorCellPos);
	const table = $anchor.node(-1);
	if (table?.type.spec.tableRole !== 'table') {
		return null;
	}

	const start = $anchor.start(-1);
	const map = TableMap.get(table);

	for (let row = 0; row < map.height; row += 1) {
		for (let col = 0; col < map.width; col += 1) {
			const index = row * map.width + col;
			// Skip a cell stretched from the previous row (rowspan).
			if (row > 0 && map.map[index] === map.map[index - map.width]) {
				continue;
			}

			const cellOffset = map.map[index];
			const node = table.nodeAt(cellOffset);
			if (!node || (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader')) {
				continue;
			}

			const cellPos = start + cellOffset;
			// Take the DOM of the cell itself (td/th), not of its first child
			// paragraph: its rect is smaller than the cell (does not account for
		// the inner padding), so a point in the cell padding did not hit the
		// rect and head was not updated — the selection did not grow toward
		// the side where the finger hovered over the overlay and cellAtPoint
		// fell back here. nodeDOM returns the whole cell node element, so its
		// rect covers the entire cell.
			const cellEl = (view.nodeDOM(cellPos) as HTMLElement | null) ?? (() => {
				const dom = view.domAtPos(cellPos);
				return (dom.node.nodeType === 1 ? dom.node.childNodes[dom.offset] : dom.node.parentElement) as HTMLElement | null;
			})();
			if (!cellEl?.getBoundingClientRect) {
				continue;
			}

			const rect = cellEl.getBoundingClientRect();
			if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
				return view.state.doc.resolve(cellPos);
			}
		}
	}
	return null;
}

/**
 * `mousedown` handler for table cell selection.
 *
 * If the click hit the selection circle (`.texto-table__overlay_overlay-circle`),
 * starts a drag selection: mouse movement builds a `TextoCellSelection` from
 * the anchor cell to the cell under the cursor. Regular clicks inside cells
 * pass through (cursor placement / editing).
 */
export function handleMouseDown(view: EditorView, startEvent: MouseEvent): boolean {
	// The synthetic compatibility mousedown that Android dispatches right after
	// a touch cell drag would collapse the freshly built TextoCellSelection
	// back to a text cursor. Swallow it while the cell selection is still
	// active and end the drag so the column-resize handles reappear.
	if (isTouchCompatMouseSuppressed() && view.state.selection instanceof TextoCellSelection) {
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
	const target = startEvent.target as HTMLElement;
	// classList instead of an exact className match: Obsidian may add its own
	// classes to the element (e.g. mobile-tap).
	if (!target?.classList?.contains('texto-table__overlay_overlay-circle')) {
		return false;
	}

	// Freeze the overlay decoration for the duration of the drag so the circle
	// (touch/pointer target) is not recreated on every dispatch, which would
	// cancel the gesture.
	beginCellDrag();

	// The anchor cell position is recorded by the decoration in the circle's
	// data-cell-pos — this is more reliable than geometry: posAtCoords can
	// degrade on mobile (workspace-drawer-backdrop).
	let topLeftAnchor = Number(target.dataset.cellPos) || null;
	let isFirstMove = true;

	function setCellSelection($anchor: ResolvedPos, event: MouseEvent) {
		if (!$anchor) return;

		const $head =
			cellAtPoint(view, event.clientX, event.clientY, isFirstMove ? CIRCLE_CLEARANCE : 0) ??
			cellInTableAtPoint(view, topLeftAnchor, event.clientX, event.clientY);
		isFirstMove = false;
		if (!$head) return;

		if (topLeftAnchor == null) {
			topLeftAnchor = $anchor.pos;
		}

		const selection = new TextoCellSelection($anchor, $head);
		view.dispatch(view.state.tr.setSelection(selection).setMeta(tableEditingKey, selection));
		scheduleOverlayRefresh(view);
	}

	function stop() {
		endCellDrag();
		win.removeEventListener('mousemove', move);
		win.removeEventListener('mouseup', stop);
		if (tableEditingKey.getState(view.state) != null) {
			view.dispatch(view.state.tr.setMeta(tableEditingKey, -1));
		}
	}

	function move(event: MouseEvent) {
		const $anchor =
			topLeftAnchor != null
				? view.state.doc.resolve(topLeftAnchor)
				: cellAtPoint(view, startEvent.clientX, startEvent.clientY, isFirstMove ? CIRCLE_CLEARANCE : 0);
		setCellSelection($anchor, event);
	}

	const win = view.dom.ownerDocument.defaultView ?? window;
	win.addEventListener('mousemove', move);
	win.addEventListener('mouseup', stop);
	startEvent.preventDefault();
	return true;
}
