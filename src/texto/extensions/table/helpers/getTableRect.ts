import {TEXTO_ERROR, TextoError} from '../../../core';
import {CellSelection, TableMap} from 'prosemirror-tables';
import {EditorView} from 'prosemirror-view';

function checkRectEnabled(node: Node) {
	return 'getBoundingClientRect' in node && typeof node.getBoundingClientRect === 'function';
}

export function getSelectedTableRect(view: EditorView, selection: CellSelection) {
	const table = selection.$anchorCell.node(-1);
	// IMPORTANT: this function is called AFTER the render has finished (see
	// refreshOverlayPosition in overlay.ts) — the DOM is up to date, so reading
	// geometry is safe. There used to be a view.updateState(view.state) hack
	// here "to wait for the DOM update", but it was called from inside the
	// widget's toDOM and recreated the whole docView — together with the
	// selection circle (the touch target), which made the browser cancel an
	// active touch gesture (touchcancel).

	const tableStart = selection.$anchorCell.start(-1);
	const map = TableMap.get(table);
	const rect = map.rectBetween(
		selection.$anchorCell.pos - tableStart,
		selection.$headCell.pos - tableStart,
	);

	const topLeftPos = tableStart + map.map[rect.top * map.width + rect.left] + 1;
	const bottomRightPos = tableStart + map.map[(rect.bottom - 1) * map.width + rect.right - 1] + 1;

	const tableNode = view.domAtPos(tableStart).node;
	const topLeftNode = view.domAtPos(topLeftPos).node;
	const bottomRightNode = view.domAtPos(bottomRightPos).node;

	if (
		!checkRectEnabled(topLeftNode) ||
		!checkRectEnabled(bottomRightNode) ||
		!checkRectEnabled(tableNode)
	) {
		throw new TextoError(TEXTO_ERROR.KNOWN_ERROR, '[Table Error] getBoundingClientRect not exist');
	}

	const tableRect = (tableNode as HTMLDivElement).getBoundingClientRect();
	const topLeftRect = (topLeftNode as HTMLDivElement).getBoundingClientRect();
	const bottomRightRect =
		topLeftNode === bottomRightNode
			? topLeftRect
			: (bottomRightNode as HTMLDivElement).getBoundingClientRect();

	return {
		top: topLeftRect.top - tableRect.top,
		left: topLeftRect.left - tableRect.left,
		height: bottomRightRect.bottom - topLeftRect.top + 1,
		width: bottomRightRect.right - topLeftRect.left + 1,
	};
}
