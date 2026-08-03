import {TEXTO_ERROR, TextoError} from '../../../core';
import {EditorState, Plugin} from 'prosemirror-state';
import {cellAround, CellSelection, columnResizingPluginKey, isInTable} from 'prosemirror-tables';
import {Decoration, DecorationSet, DecorationSource} from 'prosemirror-view';

import {findTableAnchor} from './findTableAnchor';
import {getSelectedTableRect} from './getTableRect';
import {handleMouseDown} from './handleMouseDown';

function getOverlayElement(
	rect: {top: number; left: number; width: number; height: number},
	needCircle: boolean,
) {
	const element = document.createElement('div');
	const overlayCircle = document.createElement('div');
	const circle = document.createElement('div');
	element.className = 'texto-table__overlay';
	overlayCircle.className = 'texto-table__overlay_overlay-circle';
	circle.className = 'texto-table__overlay_circle';

	element.setAttribute(
		'style',
		`top: ${rect.top.toFixed(2)}px; left: ${rect.left.toFixed(2)}px; width: ${rect.width.toFixed(
			2,
		)}px; height: ${rect.height.toFixed(2)}px;`,
	);

	overlayCircle.appendChild(circle);
	if (needCircle) {
		element.appendChild(overlayCircle);
	}
	return element;
}

function getMoreCellsSelectingDecoration(state: EditorState, isMobileView: boolean) {
	if (!(state.selection instanceof CellSelection)) {
		return null;
	}

	const selection = state.selection;
	const tableStart = state.selection.$anchorCell.start(-1);
	return Decoration.widget(tableStart, (view) => {
		try {
			const rect = getSelectedTableRect(view, selection);
			return getOverlayElement(rect, !isMobileView);
		} catch {
			return document.createElement('div');
		}
	});
}

function getOneCellSelectingDecoration(state: EditorState, isMobileView: boolean) {
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
			const selection = new CellSelection(anchor);
			const rect = getSelectedTableRect(view, selection);
			return getOverlayElement(rect, !isMobileView);
		} catch {
			return document.createElement('div');
		}
	});
}

export function drawCellSelection(state: EditorState, isMobileView: boolean): DecorationSource | null {
	const decorations: Decoration[] = [
		getMoreCellsSelectingDecoration(state, isMobileView),
		getOneCellSelectingDecoration(state, isMobileView),
	].filter(Boolean) as Decoration[];

	return DecorationSet.create(state.doc, decorations);
}

export function handleCellSelection(isMobileView: boolean) {
	return new Plugin({
		props: {
			decorations: (state) => drawCellSelection(state, isMobileView),

			handleDOMEvents: {
				// in mobile prevent mouse down
				mousedown: isMobileView ? (view) => isInTable(view.state) : handleMouseDown,
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
	});
}
