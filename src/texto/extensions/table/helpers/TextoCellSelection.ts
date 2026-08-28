import type {ResolvedPos} from 'prosemirror-model';
import {CellSelection} from 'prosemirror-tables';

/**
 * A CellSelection that does not stretch the DOM selection over the whole
 * content of the head cell.
 *
 * ProseMirror syncs the DOM selection with `selection.$anchor..$head`
 * (`selectionToDOM` → `docView.setSelection`). A regular `CellSelection` sets
 * them to the start and end of the head cell's content, so the text inside
 * the head cell becomes selected: the DOM selection is not collapsed and is
 * visually highlighted.
 *
 * Here `$head` is collapsed into `$anchor`: the DOM selection becomes a
 * collapsed caret at the start of the head cell's content and is hidden with
 * the `ProseMirror-hideselection` class (`CellSelection.visible === false`).
 *
 * Cell ranges (`ranges`), `$anchorCell`/`$headCell`, `content()`, `eq()`,
 * `getBookmark()` are inherited unchanged, so cell copy/paste, the
 * `.selectedCell` decorations and undo/history work as before.
 */
export class TextoCellSelection extends CellSelection {
	constructor($anchorCell: ResolvedPos, $headCell: ResolvedPos = $anchorCell) {
		super($anchorCell, $headCell);
		// Collapse the DOM selection: $head === $anchor (start of the head cell's
		// content).
		(this as {$head: ResolvedPos}).$head = this.$anchor;
	}
}
