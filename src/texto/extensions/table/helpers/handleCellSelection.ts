import {TEXTO_ERROR, TextoError} from '../../../core';
import {EditorState, Plugin} from 'prosemirror-state';
import {cellAround, CellSelection, columnResizingPluginKey, isInTable, TableMap} from 'prosemirror-tables';
import {Decoration, DecorationSet, DecorationSource} from 'prosemirror-view';

import {findTableAnchor} from './findTableAnchor';
import {getSelectedTableRect} from './getTableRect';
import {handleMouseDown} from './handleMouseDown';
import {handleTouchStart} from './handleTouchStart';
import {TextoCellSelection} from './TextoCellSelection';

function getOverlayElement(rect: {top: number; left: number; width: number; height: number}, anchorCellPos: number) {
	const element = createDiv();
	const overlayCircle = createDiv();
	const circle = createDiv();
	element.className = 'texto-table__overlay';
	overlayCircle.className = 'texto-table__overlay_overlay-circle';
	circle.className = 'texto-table__overlay_circle';

	// Позиция anchor-ячейки выделения: touch/mouse-обработчики начинают drag
	// отсюда, не полагаясь на posAtCoords (который на мобильной версии может
	// деградировать из-за workspace-drawer-backdrop). См. handleTouchStart.
	overlayCircle.dataset.cellPos = String(anchorCellPos);

	element.setAttribute(
		'style',
		`top: ${rect.top.toFixed(2)}px; left: ${rect.left.toFixed(2)}px; width: ${rect.width.toFixed(
			2,
		)}px; height: ${rect.height.toFixed(2)}px;`,
	);

	overlayCircle.appendChild(circle);
	element.appendChild(overlayCircle);
	return element;
}

function getMoreCellsSelectingDecoration(state: EditorState) {
	if (!(state.selection instanceof CellSelection)) {
		return null;
	}

	const selection = state.selection;
	const tableStart = state.selection.$anchorCell.start(-1);
	return Decoration.widget(tableStart, (view) => {
		try {
			const rect = getSelectedTableRect(view, selection);
			return getOverlayElement(rect, selection.$anchorCell.pos);
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
			const selection = new CellSelection(anchor);
			const rect = getSelectedTableRect(view, selection);
			return getOverlayElement(rect, selection.$anchorCell.pos);
		} catch {
			return createDiv();
		}
	});
}

/**
 * Хэндлы ресайза колонок для мобильной версии: виджеты на правом краю
 * каждого видимого сегмента колонки текущей ячейки (учитывает rowspan).
 *
 * Позиция ячейки сегмента записывается в `data-cell-pos` — touch-обработчик
 * использует её, чтобы определить ресайзимую колонку.
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
	const decorations: Decoration[] = [
		getMoreCellsSelectingDecoration(state),
		getOneCellSelectingDecoration(state),
	].filter(Boolean) as Decoration[];

	// Мобильная версия: хэндл ресайза колонки рядом с текущей ячейкой
	// (ячейка под курсором или head-ячейка выделения).
	if (isMobileView) {
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
				touchstart: handleTouchStart,
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

		// CellSelection может появиться минуя наши обработчики (undo/redo,
		// normalizeSelection из tableEditing, fixTables). Заменяем его на
		// TextoCellSelection, чтобы DOM-выделение не растягивалось на текст
		// head-ячейки (см. TextoCellSelection).
		appendTransaction(_transactions, _oldState, newState) {
			const {selection} = newState;
			if (selection instanceof CellSelection && !(selection instanceof TextoCellSelection)) {
				return newState.tr.setSelection(new TextoCellSelection(selection.$anchorCell, selection.$headCell));
			}
			return null;
		},
	});
}
