import type {EditorState} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';
import {TableMap} from 'prosemirror-tables';

import {updateColumns} from '../tableView';

const CELL_MIN_WIDTH = 25;
const DRAGGING_CLASS = 'texto-table__cell-dragging';

/**
 * Ресайз колонки таблицы перетаскиванием хэндла на тач-экране.
 *
 * Хэндл рендерится декорацией (см. `handleCellSelection`) и несёт в
 * `data-cell-pos` позицию своей ячейки. Во время drag ширина превьюится
 * напрямую в DOM (colgroup), при отпускании — коммитится в документ
 * через `colwidth` ячеек колонки.
 */
export function startColumnTouchResize(view: EditorView, startEvent: TouchEvent, handle: HTMLElement): boolean {
	if (startEvent.touches.length !== 1) {
		return false;
	}

	const cellPosAttr = handle.dataset.cellPos;
	if (cellPosAttr == null) {
		return false;
	}

	const cellPos = Number(cellPosAttr);
	const $cell = view.state.doc.resolve(cellPos);
	const cell = $cell.nodeAfter;
	if (!cell) {
		return false;
	}

	const table = $cell.node(-1);
	const tableStart = $cell.start(-1);
	const map = TableMap.get(table);
	const col = map.colCount($cell.pos - tableStart) + ((cell.attrs.colspan as number) ?? 1) - 1;

	const startWidth = currentColWidth(view, cellPos, cell.attrs as {colspan: number; colwidth?: number[] | null});
	const startX = startEvent.touches[0].clientX;
	let lastWidth = startWidth;

	const tableDom = findTableDom(view, cellPos);
	const body = view.dom.ownerDocument.body;

	function stop(commit: boolean) {
		root.removeEventListener('touchmove', move);
		root.removeEventListener('touchend', end);
		root.removeEventListener('touchcancel', cancel);
		body.classList.remove(DRAGGING_CLASS);

		if (commit && lastWidth !== startWidth) {
			const tr = updateColumnWidth(view.state, cellPos, lastWidth);
			if (tr.docChanged) {
				view.dispatch(tr);
			}
		}
	}

	function move(event: TouchEvent) {
		// Не даём drag превратиться в прокрутку документа.
		event.preventDefault();

		const touch = event.touches[0];
		if (!touch) {
			return;
		}

		lastWidth = Math.max(CELL_MIN_WIDTH, Math.round(startWidth + (touch.clientX - startX)));

		if (tableDom?.firstElementChild instanceof HTMLElement) {
			updateColumns(table, tableDom.firstElementChild, tableDom, CELL_MIN_WIDTH, col, lastWidth);
		}
	}

	function end() {
		stop(true);
	}

	function cancel() {
		stop(false);
	}

	const root = view.dom.ownerDocument;
	root.addEventListener('touchmove', move, {passive: false});
	root.addEventListener('touchend', end);
	root.addEventListener('touchcancel', cancel);
	body.classList.add(DRAGGING_CLASS);
	startEvent.preventDefault();
	return true;
}

/**
 * Текущая ширина последней колонки, которую занимает ячейка.
 */
function currentColWidth(
	view: EditorView,
	cellPos: number,
	attrs: {colspan: number; colwidth?: number[] | null},
): number {
	const {colspan, colwidth} = attrs;
	const width = colwidth && colwidth[colwidth.length - 1];
	if (width) {
		return width;
	}

	const dom = view.domAtPos(cellPos);
	const cellDom = dom.node.childNodes[dom.offset] as HTMLElement | undefined;
	let domWidth = cellDom?.offsetWidth ?? CELL_MIN_WIDTH;
	let parts = colspan;

	if (colwidth) {
		for (let index = 0; index < colspan; index += 1) {
			if (colwidth[index]) {
				domWidth -= colwidth[index];
				parts -= 1;
			}
		}
	}

	return parts > 0 ? domWidth / parts : CELL_MIN_WIDTH;
}

/**
 * Находит TABLE-элемент по позиции ячейки.
 */
function findTableDom(view: EditorView, cellPos: number): HTMLTableElement | null {
	const dom = view.domAtPos(cellPos);
	let node = dom.node as HTMLElement | null;
	while (node && node.nodeName !== 'TABLE') {
		node = node.parentElement;
	}
	return node as HTMLTableElement | null;
}

/**
 * Транзакция, проставляющая новую ширину последней колонке ячейки
 * во всех строках (аналог updateColumnWidth из prosemirror-tables).
 */
function updateColumnWidth(state: EditorState, cellPos: number, width: number) {
	const $cell = state.doc.resolve(cellPos);
	const table = $cell.node(-1);
	const map = TableMap.get(table);
	const start = $cell.start(-1);
	const col = map.colCount($cell.pos - start) + (($cell.nodeAfter?.attrs.colspan as number) ?? 1) - 1;
	const tr = state.tr;

	for (let row = 0; row < map.height; row += 1) {
		const mapIndex = row * map.width + col;
		// Ячейка с rowspan тянется из предыдущей строки — пропускаем.
		if (row && map.map[mapIndex] === map.map[mapIndex - map.width]) {
			continue;
		}

		const pos = map.map[mapIndex];
		const node = table.nodeAt(pos);
		if (!node) {
			continue;
		}

		const attrs = node.attrs as {colspan: number; colwidth?: number[] | null};
		const index = attrs.colspan === 1 ? 0 : col - map.colCount(pos);
		if (attrs.colwidth && attrs.colwidth[index] === width) {
			continue;
		}

		const colwidth = attrs.colwidth ? attrs.colwidth.slice() : new Array<number>(attrs.colspan).fill(0);
		colwidth[index] = width;
		tr.setNodeMarkup(start + pos, null, {...attrs, colwidth});
	}

	return tr;
}
