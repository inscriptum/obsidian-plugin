import type {ResolvedPos} from 'prosemirror-model';
import {CellSelection} from 'prosemirror-tables';

/**
 * CellSelection, который не растягивает DOM-выделение на весь контент head-ячейки.
 *
 * ProseMirror синхронизирует DOM-выделение с `selection.$anchor..$head`
 * (`selectionToDOM` → `docView.setSelection`). Обычный `CellSelection` задаёт их
 * как начало и конец контента head-ячейки, поэтому текст внутри head-ячейки
 * оказывается выделен: DOM-выделение не collapsed и визуально подсвечивается.
 *
 * Здесь `$head` схлопывается в `$anchor`: DOM-выделение становится collapsed-
 * курсором в начале контента head-ячейки и скрывается классом
 * `ProseMirror-hideselection` (`CellSelection.visible === false`).
 *
 * Диапазоны ячеек (`ranges`), `$anchorCell`/`$headCell`, `content()`, `eq()`,
 * `getBookmark()` наследуются без изменений, поэтому копирование/вставка
 * ячеек, декорации `.selectedCell` и undo/history работают как раньше.
 */
export class TextoCellSelection extends CellSelection {
	constructor($anchorCell: ResolvedPos, $headCell: ResolvedPos = $anchorCell) {
		super($anchorCell, $headCell);
		// Схлопываем DOM-выделение: $head === $anchor (начало контента head-ячейки).
		(this as {$head: ResolvedPos}).$head = this.$anchor;
	}
}
