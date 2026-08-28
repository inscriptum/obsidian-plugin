import type {ResolvedPos} from 'prosemirror-model';
import type {EditorView} from 'prosemirror-view';
import {tableEditingKey} from 'prosemirror-tables';

import {beginCellDrag, cancelPendingCellGesture, endCellDrag, isCellDragActive, setPendingCellGestureCancel} from './cellDragFreeze';
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
const PICKING_RECT_CLASS = 'texto-table__cell-picking-rect';

/**
 * Touch handler for tables on mobile (and touchscreens on desktop):
 * - touch on the selection circle (`.texto-table__overlay_overlay-circle`) —
 *   drag cell selection, the touch counterpart of the mouse gesture;
 * - touch on a resize handle (`.texto-table__resize-handle`) — column
 *   width drag-resize.
 *
 * Long-press on a table cell is handled separately in handlePointerDown:
 * see there for why it must run on Pointer Events instead of touch events.
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

	// The touch zone is the outer circle element, but the finger can land on
	// the inner visual dot (.texto-table__overlay_circle) — resolve the touch
	// zone through the overlay.
	const overlay = target.closest('.texto-table__overlay');
	const circle = (overlay?.querySelector('.texto-table__overlay_overlay-circle') as HTMLElement | null) ??
		(target.closest('.texto-table__overlay_overlay-circle') as HTMLElement | null);
	if (circle) {
		if (startEvent.touches.length !== 1) {
			return false;
		}

		beginCellDrag();

		// The anchor cell position is recorded by the decoration in the
		// circle's data-cell-pos — this is more reliable than geometry:
		// posAtCoords can degrade on mobile (workspace-drawer-backdrop).
		runCellDrag(view, startEvent, Number(circle.dataset.cellPos) || null, CIRCLE_CLEARANCE);
		startEvent.preventDefault();
		return true;
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
export function handlePointerDown(view: EditorView, event: PointerEvent): boolean {
	if (event.pointerType !== 'touch' || !event.isPrimary) {
		return false;
	}

	const target = event.target as HTMLElement | null;
	if (!target?.classList) {
		return false;
	}

	// The circle and the resize handles have their own touch-based gestures.
	if (
		target.classList.contains('texto-table__resize-handle') ||
		target.closest('.texto-table__overlay')
	) {
		return false;
	}

	const startCellEl = target.closest('td, th');
	if (!startCellEl) {
		return false;
	}

	return startLongPressCellSelection(view, event, startCellEl as HTMLElement);
}

/**
 * Resolves the drag endpoints for the circle drag: the anchor cell (from the
 * gesture start point or a recorded position) and the head cell under the
 * current point.
 *
 * `clearance` shifts the head point up-left on the first move of a circle
 * drag, where the pointer stands on the circle in the cell corner.
 */
function dragToCellHead(
	view: EditorView,
	topLeftAnchor: number | null,
	anchorX: number,
	anchorY: number,
	headX: number,
	headY: number,
	isFirstMove: boolean,
	clearance: number,
): {anchor: ResolvedPos; head: ResolvedPos; topLeft: number} | null {
	const $anchor =
		topLeftAnchor != null
			? view.state.doc.resolve(topLeftAnchor)
			: cellAtPoint(view, anchorX, anchorY, isFirstMove ? clearance : 0);
	if (!$anchor) {
		return null;
	}

	const $head =
		cellAtPoint(view, headX, headY, isFirstMove ? clearance : 0) ??
		cellInTableAtPoint(view, topLeftAnchor ?? $anchor.pos, headX, headY);
	if (!$head) {
		return null;
	}

	return {anchor: $anchor, head: $head, topLeft: topLeftAnchor ?? $anchor.pos};
}

/**
 * The ProseMirror position of the cell node for a td/th element.
 *
 * Uses view.posAtDOM (a direct DOM→doc mapping) instead of posAtCoords:
 * posAtCoords is hit-test based and degrades on mobile (it can resolve the
 * same screen point to different cells between gestures), while posAtDOM is
 * exact for a node we already hold.
 */
function cellPosFromDom(view: EditorView, cellEl: HTMLElement): ResolvedPos | null {
	try {
		const $inner = view.state.doc.resolve(view.posAtDOM(cellEl, 0));
		for (let depth = $inner.depth; depth > 0; depth -= 1) {
			const role = $inner.node(depth).type.spec.tableRole;
			if (role === 'cell' || role === 'header_cell') {
				return view.state.doc.resolve($inner.before(depth));
			}
		}
	} catch {
		// The element may be detached (stale gesture) — no position then.
	}
	return null;
}

function dispatchCellSelection(view: EditorView, $anchor: ResolvedPos, $head: ResolvedPos): void {
	const selection = new TextoCellSelection($anchor, $head);
	view.dispatch(view.state.tr.setSelection(selection).setMeta(tableEditingKey, selection));
	scheduleOverlayRefresh(view);
}

/**
 * Touch drag for the selection circle: touchmove builds a TextoCellSelection
 * from the anchor cell to the cell under the finger.
 *
 * The overlay decoration is frozen for the whole gesture (beginCellDrag) so
 * ProseMirror reuses the circle DOM node instead of recreating it — removing
 * the touch target mid-gesture makes the browser cancel the touch
 * (touchcancel), which killed the drag after its first move. Unlike the
 * long-press gesture this path is safe on touch events: the circle is a
 * widget whose node survives the re-render (the freeze), and preventDefault
 * on touchstart suppresses the compatibility mouse events entirely.
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
		const current = point(event);
		const drag = dragToCellHead(
			view,
			topLeftAnchor,
			start.clientX,
			start.clientY,
			current.clientX,
			current.clientY,
			isFirstMove,
			clearance,
		);
		isFirstMove = false;
		if (!drag) return;

		topLeftAnchor = drag.topLeft;
		dispatchCellSelection(view, drag.anchor, drag.head);
	}

	const root = view.dom.ownerDocument;
	root.addEventListener('touchmove', move, {passive: false});
	root.addEventListener('touchend', end);
	root.addEventListener('touchcancel', stop);
}

/**
 * The table element the given cell belongs to (visible one — the geometry of
 * hidden duplicate leaves is all zeros).
 */
function cellTable(cell: HTMLElement): HTMLTableElement | null {
	const wrapper = cell.closest('.table-wrapper');
	const table = wrapper?.querySelector('table') ?? cell.closest('table');
	return table instanceof HTMLTableElement && table.getBoundingClientRect().width > 0 ? table : null;
}

/**
 * The td/th whose rect contains the point. Pure DOM hit-testing — does not
 * depend on elementFromPoint (workspace-drawer-backdrop can swallow it on
 * mobile) or on ProseMirror state.
 */
function domCellAtPoint(table: HTMLTableElement | null, x: number, y: number): HTMLElement | null {
	if (!table) {
		return null;
	}

	for (const row of Array.from(table.rows)) {
		for (const cell of Array.from(row.cells)) {
			const rect = cell.getBoundingClientRect();
			if (rect.width > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
				return cell;
			}
		}
	}
	return null;
}

/** Highlights the rectangle of cells from anchor to head (direct DOM). */
function redrawPicked(anchor: HTMLElement | null, head: HTMLElement | null): HTMLElement | null {
	let rect = document.querySelector(':scope > body > .' + PICKING_RECT_CLASS) as HTMLElement | null;
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
		'style',
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
	const viewDom = view.dom as HTMLElement;
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
		viewDom.removeEventListener('pointermove', dragMove);
		viewDom.removeEventListener('pointerup', dragEnd);
		viewDom.removeEventListener('pointercancel', dragCancel);
	}

	function cleanup(): void {
		window.clearTimeout(timer);
		viewDom.removeEventListener('pointermove', onMove);
		viewDom.removeEventListener('pointerup', onUp);
		viewDom.removeEventListener('pointercancel', onUp);
		body.classList.remove(CELL_SELECTING_CLASS);
		clearPicked();
	}

	function activate(): void {
		// Pre-activation listeners are replaced by the drag ones.
		viewDom.removeEventListener('pointermove', onMove);
		viewDom.removeEventListener('pointerup', onUp);
		viewDom.removeEventListener('pointercancel', onUp);

		anchorDom = startCell.isConnected ? startCell : (document.elementFromPoint(startX, startY)?.closest('td, th') as HTMLElement | null);

		if (!$anchor) {
			cleanup();
			return;
		}

		beginCellDrag();

		// Light haptic feedback that the long-press was recognized.
		navigator.vibrate?.(10);

		redrawPicked(anchorDom, null);
		viewDom.addEventListener('pointermove', dragMove);
		viewDom.addEventListener('pointerup', dragEnd);
		viewDom.addEventListener('pointercancel', dragCancel);
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
		viewDom.removeEventListener('pointermove', onMove);
		viewDom.removeEventListener('pointerup', onUp);
		viewDom.removeEventListener('pointercancel', onUp);
		body.classList.remove(CELL_SELECTING_CLASS);

		let lastY = event.clientY;
		const scroller = findScrollParent(startCell instanceof HTMLElement ? startCell : null);

		const scrollMove = (e: PointerEvent) => {
			if (scroller) {
				scroller.scrollTop -= e.clientY - lastY;
			}
			lastY = e.clientY;
		};
		const scrollEnd = () => {
			viewDom.removeEventListener('pointermove', scrollMove);
			viewDom.removeEventListener('pointerup', scrollEnd);
			viewDom.removeEventListener('pointercancel', scrollEnd);
		};
		viewDom.addEventListener('pointermove', scrollMove);
		viewDom.addEventListener('pointerup', scrollEnd);
		viewDom.addEventListener('pointercancel', scrollEnd);
	}

	function onUp(): void {
		// Released before the timer fired: a regular tap.
		cleanup();
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
	viewDom.addEventListener('pointermove', onMove);
	viewDom.addEventListener('pointerup', onUp);
	viewDom.addEventListener('pointercancel', onUp);
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
 * The nearest ancestor of the cell that actually scrolls (the note scroller).
 */
function findScrollParent(startCell: HTMLElement | null): HTMLElement | null {
	let el = startCell?.parentElement ?? null;
	while (el && el !== document.body) {
		if (el.scrollHeight > el.clientHeight + 1) {
			const overflow = getComputedStyle(el).overflowY;
			if (overflow === 'auto' || overflow === 'scroll') {
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
