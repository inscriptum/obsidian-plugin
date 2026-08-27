import type {ResolvedPos} from 'prosemirror-model';
import type {EditorView} from 'prosemirror-view';
import {tableEditingKey} from 'prosemirror-tables';

import {startColumnTouchResize} from './columnTouchResize';
import {cellAtPoint, cellInTableAtPoint} from './handleMouseDown';
import {TextoCellSelection} from './TextoCellSelection';

/** Clearance для первого движения drag с кружка — см. handleMouseDown.ts. */
const CIRCLE_CLEARANCE = 18;

/**
 * Touch-обработчик таблиц для мобильной версии (и тачскринов на десктопе):
 * - касание кружка выделения (`.texto-table__overlay_overlay-circle`) —
 *   drag-выделение ячеек, аналог mouse-жеста;
 * - касание хэндла ресайза (`.texto-table__resize-handle`) — изменение
 *   ширины колонки перетаскиванием.
 *
 * Остальные касания пропускаются дальше (курсор/редактирование через
 * compat mouse-события).
 */
export function handleTouchStart(view: EditorView, startEvent: TouchEvent): boolean {
	const target = startEvent.target as HTMLElement | null;
	if (!target?.classList) {
		return false;
	}

	if (target.classList.contains('texto-table__resize-handle')) {
		return startColumnTouchResize(view, startEvent, target);
	}

	// classList, а не точное сравнение className: Obsidian может добавлять
	// элементу собственные классы (например, mobile-tap).
	if (!target.classList.contains('texto-table__overlay_overlay-circle')) {
		return false;
	}

	if (startEvent.touches.length !== 1) {
		return false;
	}

	// Anchor-ячейка записана декорацией в data-cell-pos кружка — это надёжнее
	// геометрии: posAtCoords на мобильной версии может деградировать.
	let topLeftAnchor = Number(target.dataset.cellPos) || null;
	let isFirstMove = true;

	function point(event: TouchEvent) {
		return event.touches[0] ?? event.changedTouches[0];
	}

	function setCellSelection($anchor: ResolvedPos | null, event: TouchEvent) {
		if (!$anchor) return;

		const touch = point(event);
		const $head =
			cellAtPoint(view, touch.clientX, touch.clientY, isFirstMove ? CIRCLE_CLEARANCE : 0) ??
			cellInTableAtPoint(view, topLeftAnchor, touch.clientX, touch.clientY);
		isFirstMove = false;
		if (!$head) return;

		if (topLeftAnchor == null) {
			topLeftAnchor = $anchor.pos;
		}

		const selection = new TextoCellSelection($anchor, $head);
		view.dispatch(view.state.tr.setSelection(selection).setMeta(tableEditingKey, selection));
	}

	function stop() {
		root.removeEventListener('touchmove', move);
		root.removeEventListener('touchend', stop);
		root.removeEventListener('touchcancel', stop);
		if (tableEditingKey.getState(view.state) != null) {
			view.dispatch(view.state.tr.setMeta(tableEditingKey, -1));
		}
	}

	function move(event: TouchEvent) {
		// Не даём drag превратиться в прокрутку документа.
		event.preventDefault();

		const start = point(startEvent);
		const $anchor =
			topLeftAnchor != null
				? view.state.doc.resolve(topLeftAnchor)
				: cellAtPoint(view, start.clientX, start.clientY, isFirstMove ? CIRCLE_CLEARANCE : 0);
		setCellSelection($anchor, event);
	}

	const root = view.dom.ownerDocument;
	root.addEventListener('touchmove', move, {passive: false});
	root.addEventListener('touchend', stop);
	root.addEventListener('touchcancel', stop);
	startEvent.preventDefault();
	return true;
}
