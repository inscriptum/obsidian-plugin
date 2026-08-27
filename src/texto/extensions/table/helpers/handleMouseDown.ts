import type {ResolvedPos} from 'prosemirror-model';
import type {EditorView} from 'prosemirror-view';
import {tableEditingKey, TableMap} from 'prosemirror-tables';

import {TextoCellSelection} from './TextoCellSelection';

/**
 * Сдвиг точки влево-вверх на первом движении drag: указатель стоит на кружке
 * выделения (в углу ячейки, поверх контента и не в дереве документа).
 * Кружок имеет touch-зону, расширенную на 10px (::before, inset: -10px,
 * см. mobile.css), поэтому clearance должен превышать её.
 *
 * На узких колонках (телефон) фиксированный сдвиг может выбросить точку
 * за пределы ячейки, поэтому точка берётся с прогрессирующе уменьшающимся
 * сдвигом — до первого попадания в ячейку (см. cellAtPoint).
 */
const CIRCLE_CLEARANCE = 18;

/** Доли clearance для перебора в cellAtPoint. */
const CLEARANCE_STEPS = [1, 0.66, 0.33, 0] as const;

/**
 * Ячейка, содержащая позицию (включая сам уровень ячейки).
 *
 * В отличие от cellAround из prosemirror-tables, который начинает подъём
 * с depth − 1, здесь учитывается и уровень самой ячейки: posAtCoords может
 * вернуть позицию ровно на границе содержимого ячейки — например, позицию
 * виджета-хэндла ресайза (на телефоне хэндлы перекрывают часть ячеек).
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
 * Находит ячейку под указанной точкой экрана.
 *
 * `offset` сдвигает точку влево-вверх: используется на первом движении drag,
 * когда указатель стоит на кружке выделения (в углу ячейки) и его нужно
 * завести внутрь anchor-ячейки. Если с полным сдвигом точка уходит мимо
 * ячейки (узкая колонка на телефоне), сдвиг уменьшается пошагово.
 */
export function cellAtPoint(view: EditorView, clientX: number, clientY: number, offset = 0) {
	for (const step of CLEARANCE_STEPS) {
		const shift = Math.round(offset * step);
		const x = clientX - shift;
		const y = clientY - shift;

		// Точки на оверлее выделения (кружок, его расширенная touch-зона) не
		// резолвим: posAtCoords вернёт позицию виджета, которая схлопнет head
		// в anchor-ячейку и заблокирует рост прямоугольника выделения.
		const hit = view.dom.ownerDocument.elementFromPoint(x, y);
		if (hit?.closest('.texto-table__overlay')) continue;

		const pos = view.posAtCoords({left: x, top: y});
		if (!pos) continue;

		const $pos = view.state.doc.resolve(pos.pos);
		const cell = $pos.nodeAfter;
		if (cell && (cell.type.name === 'tableCell' || cell.type.name === 'tableHeader')) return $pos;

		// posAtCoords обычно указывает внутрь текста абзаца или на границу
		// содержимого ячейки — поднимаемся по иерархии до ячейки.
		const around = cellContaining($pos);
		if (around) return around;
	}
	return null;
}

/**
 * Ячейка таблицы anchor-ячейки, чей прямоугольник содержит точку.
 *
 * Резолв по прямоугольникам DOM не использует elementFromPoint, поэтому
 * работает даже когда workspace-drawer-backdrop (подложка мобильных drawer'ов
 * Obsidian) перехватывает hit-testing и posAtCoords деградирует. Используется
 * как фолбэк для head-ячейки при drag-выделении.
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
			// Ячейка с rowspan тянется из предыдущей строки — пропускаем повтор.
			if (row > 0 && map.map[index] === map.map[index - map.width]) {
				continue;
			}

			const cellOffset = map.map[index];
			const node = table.nodeAt(cellOffset);
			if (!node || (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader')) {
				continue;
			}

			const cellPos = start + cellOffset;
			const dom = view.domAtPos(cellPos);
			const element =
				dom.node.nodeType === 1 ? (dom.node.childNodes[dom.offset] as HTMLElement | undefined) : (dom.node.parentElement as HTMLElement | null);
			if (!element?.getBoundingClientRect) {
				continue;
			}

			const rect = element.getBoundingClientRect();
			if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
				return view.state.doc.resolve(cellPos);
			}
		}
	}
	return null;
}

/**
 * Обработчик `mousedown` для выделения ячеек таблицы.
 *
 * Если клик пришёлся на кружок выделения (`.texto-table__overlay_overlay-circle`),
 * запускает drag-выделение: движение мыши строит `TextoCellSelection` от
 * anchor-ячейки до ячейки под курсором. Обычные клики внутри ячеек
 * пропускаются дальше (курсор/редактирование).
 */
export function handleMouseDown(view: EditorView, startEvent: MouseEvent): boolean {
	const target = startEvent.target as HTMLElement;
	// classList, а не точное сравнение className: Obsidian может добавлять
	// элементу собственные классы (например, mobile-tap).
	if (!target?.classList?.contains('texto-table__overlay_overlay-circle')) {
		return false;
	}

	// Anchor-ячейка записана декорацией в data-cell-pos кружка — это надёжнее
	// геометрии: posAtCoords на мобильной версии может деградировать.
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
	}

	function stop() {
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
