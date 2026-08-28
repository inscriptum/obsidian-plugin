import {EditorState, Plugin} from 'prosemirror-state';
import {cellAround, CellSelection, columnResizingPluginKey, TableMap} from 'prosemirror-tables';
import {Decoration, DecorationSet, DecorationSource} from 'prosemirror-view';

import {isCellDragActive, overlayForDraw} from './cellDragFreeze';
import {handleMouseDown} from './handleMouseDown';
import {handleTouchStart} from './handleTouchStart';
import {TextoCellSelection} from './TextoCellSelection';

/**
 * Column resize handles for the mobile view: widgets on the right edge of
 * every visible segment of the current cell's column (rowspan-aware).
 *
 * The segment cell position is recorded in `data-cell-pos` — the touch
 * handler uses it to determine the column being resized.
 */
function getResizeHandleDecorations(state: EditorState, cellPos: number): Decoration[] {
	const $cell = state.doc.resolve(cellPos);
	const table = $cell.node(-1);
	const tableStart = $cell.start(-1);
	const map = TableMap.get(table);
	const col = map.colCount($cell.pos - tableStart) + (($cell.nodeAfter?.attrs.colspan as number) ?? 1) - 1;

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
		handle.className = 'texto-table__resize-handle';
		handle.dataset.cellPos = String(tableStart + segmentPos);

		decorations.push(
			Decoration.widget(tableStart + segmentPos + segment.nodeSize - 1, handle, {
				key: `texto-table-resize-handle-${col}-${row}`,
			}),
		);
	}

	return decorations;
}

export function drawCellSelection(state: EditorState, isMobileView: boolean): DecorationSource | null {
	// While a drag is active, overlayForDraw returns the SAME instance as in
	// the previous frame — ProseMirror reuses the circle's DOM node, so the
	// touch target is not removed (otherwise the browser cancels the gesture,
	// see cellDragFreeze.ts).
	const overlay = overlayForDraw(state);
	const decorations: Decoration[] = overlay ? [overlay] : [];

	// Mobile view: a column resize handle next to the current cell (the cell
	// under the cursor or the head cell of the selection). During a selection
	// drag the handles are not needed and recreating them repaints the table
	// subtree, removing the circle (the touch target) — so they are skipped.
	if (isMobileView && !isCellDragActive()) {
		const {selection} = state;
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

export function handleCellSelection(isMobileView: boolean) {
	return new Plugin({
		props: {
			decorations: (state) => drawCellSelection(state, isMobileView),

			handleDOMEvents: {
				mousedown: handleMouseDown,
				mousemove: (view) => {
					const pluginState = columnResizingPluginKey.getState(view.state);
					const className = 'texto-table__cell-dragging';
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

			// Suppress the native context menu while a cell drag is active:
			// on Android a long-press fires contextmenu right after the
			// long-press threshold and would interrupt the ongoing selection drag.
			const onContextMenu = (event: MouseEvent) => {
				if (isCellDragActive()) {
					event.preventDefault();
				}
			};

			editorView.dom.addEventListener('touchstart', onTouchStart, { passive: false });
			editorView.dom.addEventListener('contextmenu', onContextMenu);
			return {
				destroy() {
					editorView.dom.removeEventListener('touchstart', onTouchStart);
					editorView.dom.removeEventListener('contextmenu', onContextMenu);
				},
			};
		},

		// A CellSelection can appear without going through our handlers
		// (undo/redo, normalizeSelection from tableEditing, fixTables). Replace
		// it with TextoCellSelection so the DOM selection does not stretch over
		// the head cell's text (see TextoCellSelection).
		appendTransaction(_transactions, _oldState, newState) {
			const {selection} = newState;
			if (selection instanceof CellSelection && !(selection instanceof TextoCellSelection)) {
				return newState.tr.setSelection(new TextoCellSelection(selection.$anchorCell, selection.$headCell));
			}
			return null;
		},
	});
}
