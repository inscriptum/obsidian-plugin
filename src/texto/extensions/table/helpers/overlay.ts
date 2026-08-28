import type {EditorState} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';
import {cellAround, CellSelection, isInTable} from 'prosemirror-tables';
import {Decoration} from 'prosemirror-view';

import {TEXTO_ERROR, TextoError} from '../../../core';
import {findTableAnchor} from './findTableAnchor';
import {getSelectedTableRect} from './getTableRect';

// The current overlay DOM node and the view that owns it. The cache lets us
// update the overlay position in place (refreshOverlayPosition) between
// redraws instead of recreating the node.
let overlayNode: HTMLElement | null = null;
let overlayView: EditorView | null = null;

function createOverlayElement(anchorCellPos: number) {
	const element = createDiv();
	const overlayCircle = createDiv();
	const circle = createDiv();
	element.className = 'texto-table__overlay';
	overlayCircle.className = 'texto-table__overlay_overlay-circle';
	circle.className = 'texto-table__overlay_circle';

	// The anchor cell position is recorded by the touch/mouse handlers here
	// instead of relying on posAtCoords, which can degrade on mobile because
	// of the workspace-drawer-backdrop. See handleTouchStart.
	overlayCircle.dataset.cellPos = String(anchorCellPos);

	overlayCircle.appendChild(circle);
	element.appendChild(overlayCircle);
	return element;
}

/**
 * Recomputes the rect of the current selection and applies it to the cached
 * overlay node (position + anchor cell in data-cell-pos).
 *
 * IMPORTANT: called only AFTER the render has finished (requestAnimationFrame),
 * when the DOM is up to date. This used to be view.updateState() called from
 * inside toDOM — a full docView re-render that destroyed every widget node,
 * including the selection circle (the touch target), which made the browser
 * cancel the gesture (touchcancel) and killed the smooth cell drag after its
 * first move.
 */
export function refreshOverlayPosition(view: EditorView): void {
	const node = overlayNode;
	if (!node || !node.isConnected || overlayView !== view) {
		return;
	}

	const {selection} = view.state;

	let cellSelection: CellSelection | null = null;
	if (selection instanceof CellSelection) {
		cellSelection = selection;
	} else if (isInTable(view.state)) {
		const anchor = findTableAnchor(view.state, -1);
		cellSelection = anchor ? new CellSelection(anchor) : null;
	}

	if (!cellSelection) {
		return;
	}

	try {
		const rect = getSelectedTableRect(view, cellSelection);
		node.setAttribute(
			'style',
			`top: ${rect.top.toFixed(2)}px; left: ${rect.left.toFixed(2)}px; width: ${rect.width.toFixed(
				2,
			)}px; height: ${rect.height.toFixed(2)}px;`,
		);
		const circle = node.querySelector('.texto-table__overlay_overlay-circle');
		if (circle) {
			(circle as HTMLElement).dataset.cellPos = String(cellSelection.$anchorCell.pos);
		}
	} catch {
		// The geometry may be gone (cell removed, etc.) — skip silently.
	}
}

/** Schedule an overlay position update for after the current frame (rAF). */
export function scheduleOverlayRefresh(view: EditorView): void {
	requestAnimationFrame(() => {
		refreshOverlayPosition(view);
	});
}

/**
 * The table node the current selection belongs to. Used as the identity of
 * the cached overlay: a frozen overlay is only reused while the selection
 * stays within the same table. Node objects are immutable, so comparing
 * them by identity is stable as long as the document does not change (it
 * does not during a drag).
 */
export function overlayTableKey(state: EditorState): object | null {
	if (state.selection instanceof CellSelection) {
		return state.selection.$anchorCell.node(-1);
	}
	if (isInTable(state)) {
		return findTableAnchor(state)?.node() ?? null;
	}
	return null;
}

function getMoreCellsSelectingDecoration(state: EditorState) {
	if (!(state.selection instanceof CellSelection)) {
		return null;
	}

	const selection = state.selection;
	const tableStart = state.selection.$anchorCell.start(-1);
	return Decoration.widget(tableStart, (view) => {
		try {
			const element = createOverlayElement(selection.$anchorCell.pos);
			overlayNode = element;
			overlayView = view;
			scheduleOverlayRefresh(view);
			return element;
		} catch {
			return createDiv();
		}
	});
}

function getOneCellSelectingDecoration(state: EditorState) {
	if (state.selection instanceof CellSelection || !isInTable(state)) {
		return null;
	}

	const cell = cellAround(state.selection.$anchor);

	if (!cell) {
		return;
	}

	const start = findTableAnchor(state);
	if (!start) {
		return null;
	}

	return Decoration.widget(start.pos - start.parentOffset, (view) => {
		try {
			const anchor = findTableAnchor(view.state, -1);
			if (!anchor) {
				throw new TextoError(
					TEXTO_ERROR.KNOWN_ERROR,
					'[Table Error] The table anchor was not found',
				);
			}
			const element = createOverlayElement(anchor.pos);
			overlayNode = element;
			overlayView = view;
			scheduleOverlayRefresh(view);
			return element;
		} catch {
			return createDiv();
		}
	});
}

/**
 * The selection overlay (frame + circle) for the current state.
 *
 * The rect is NOT computed here: geometry is read in refreshOverlayPosition
 * after the render. Reading DOM geometry inside toDOM requires
 * view.updateState (the old hack from getSelectedTableRect), which recreates
 * the circle DOM node and kills an active touch gesture.
 */
export function buildSelectionOverlayDecoration(state: EditorState): Decoration | null {
	return getMoreCellsSelectingDecoration(state) ?? getOneCellSelectingDecoration(state);
}
