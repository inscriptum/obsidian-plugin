import {ResolvedPos} from 'prosemirror-model';
import {cellAround, CellSelection, inSameTable, tableEditingKey} from 'prosemirror-tables';
import {EditorView} from 'prosemirror-view';

/**
 * Get the cell that is placed under mouse cursor
 */
function cellUnderMouse(view: EditorView, event: MouseEvent, offset = 0): ResolvedPos | null {
	const mousePos = view.posAtCoords({
		left: event.clientX - offset,
		top: event.clientY - offset,
	});
	if (!mousePos) {
		return null;
	}
	return mousePos ? cellAround(view.state.doc.resolve(mousePos.pos)) : null;
}

/**
 * Subtexto to clicking on the selection circle and
 * track the mousemove event to change selection state
 * @param view EditorView
 * @param startEvent MouseEvent
 */
export function handleMouseDown(view: EditorView, startEvent: MouseEvent): boolean {
	// We do not handle mouse down if we clicked outside texto-table__overlay_overlay-circle or the current selection is not CellSelection
	if ((startEvent.target as HTMLElement).className !== 'texto-table__overlay_overlay-circle') {
		return false;
	}
	/** The anchor cell position */
	let topLeftAnchor =
		view.state.selection instanceof CellSelection ? view.state.selection.$anchorCell.pos : null;
	let isFirstMove = true;

	// Create and dispatch a cell selection between the given anchor and
	// the position under the mouse.
	function setCellSelection($anchor: ResolvedPos, event: MouseEvent): void {
		let $head = cellUnderMouse(view, event, isFirstMove ? 15 : 0);
		const starting = tableEditingKey.getState(view.state) == null;
		if (!$head || !inSameTable($anchor, $head)) {
			if (!starting) {
				return;
			}
			$head = $anchor;
		}
		const selection = new CellSelection($anchor, $head);
		if (starting || !view.state.selection.eq(selection)) {
			const tr = view.state.tr.setSelection(selection);
			if (starting) {
				tr.setMeta(tableEditingKey, $anchor.pos);
			}
			view.dispatch(tr);
		}
	}

	// Stop listening to mouse motion events.
	function stop(): void {
		view.root.removeEventListener('mouseup', stop);
		view.root.removeEventListener('dragstart', stop);
		view.root.removeEventListener('mousemove', move);

		if (tableEditingKey.getState(view.state) != null) {
			view.dispatch(view.state.tr.setMeta(tableEditingKey, -1));
		}
	}

	function move(_event: Event): void {
		const event = _event as MouseEvent;
		// Continuing an existing cross-cell selection
		let $anchor;
		if (topLeftAnchor) {
			$anchor = view.state.doc.resolve(topLeftAnchor);
		} else {
			$anchor = cellUnderMouse(view, startEvent, 15);
			topLeftAnchor = $anchor?.pos ?? null;
		}

		if (!$anchor) {
			return stop();
		}
		setCellSelection($anchor, event);
		isFirstMove = false;
	}

	view.root.addEventListener('mouseup', stop);
	view.root.addEventListener('dragstart', stop);
	view.root.addEventListener('mousemove', move);

	startEvent.preventDefault();
	return true;
}
