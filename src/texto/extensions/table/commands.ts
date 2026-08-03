import {Command} from '../../core/@types';
import {AnyConfig} from '../../core/@types/AnyConfig';
import {TextSelection} from 'prosemirror-state';
import {
	addColumnAfter,
	addColumnBefore,
	addRowAfter,
	addRowBefore,
	CellSelection,
	deleteColumn,
	deleteRow,
	deleteTable,
	fixTables,
	goToNextCell,
	isInTable,
	mergeCells,
	selectionCell,
	splitCell,
	toggleHeader,
	toggleHeaderCell,
} from 'prosemirror-tables';

import {findTableAnchor} from './helpers';
import {createTable} from './helpers/createTable';

type AddCommandsThis = ThisParameterType<Required<AnyConfig>['addCommands']>;

function insertTable(this: AddCommandsThis, {rows = 3, cols = 3, withHeaderRow = true} = {}): Command {
	return ({tr, dispatch, editor, state}) => {
		const isReplaceLastElement = state.doc.content.size === state.selection.$to.pos + 1;
		if (isReplaceLastElement) {
			const paragraph = state.schema.nodes.paragraph.createAndFill();
			if (paragraph != null) {
				tr = tr.insert(state.selection.$to.pos + 1, paragraph);
			}
		}
		const node = createTable(editor.schema, rows, cols, withHeaderRow);

		if (dispatch) {
			tr.replaceSelectionWith(node);
			tr.scrollIntoView();
			tr.setSelection(TextSelection.near(tr.doc.resolve(state.selection.$from.pos + 1)));
		}

		return true;
	};
}

function addColumnBeforeOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return addColumnBefore(state, dispatch);
	};
}

function addColumnAfterOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return addColumnAfter(state, dispatch);
	};
}

function deleteColumnOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return deleteColumn(state, dispatch);
	};
}

function addRowBeforeOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return addRowBefore(state, dispatch);
	};
}

function addRowAfterOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return addRowAfter(state, dispatch);
	};
}

function deleteRowOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return deleteRow(state, dispatch);
	};
}

function deleteTableOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return deleteTable(state, dispatch);
	};
}

function clearTable(this: AddCommandsThis): Command {
	return ({tr, dispatch, state}) => {
		const anchor = findTableAnchor(state, -1, state.selection.$anchor);
		if (!anchor) {
			return false;
		}
		if (!dispatch) {
			return true;
		}

		const lastCellSize = anchor.node(-1).content.lastChild?.content.lastChild?.nodeSize ?? 0;
		const $head = state.doc.resolve(anchor.before(-1) + anchor.node(-1).nodeSize - lastCellSize - 2);
		const $anchor = state.doc.resolve(anchor.start(-1) + 1);
		const selection = new CellSelection($anchor, $head);

		tr.setSelection(selection).deleteSelection();

		return true;
	};
}

function mergeCellsOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return mergeCells(state, dispatch);
	};
}

function splitCellOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return splitCell(state, dispatch);
	};
}

function toggleHeaderColumn(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return toggleHeader('column')(state, dispatch);
	};
}

function toggleHeaderRow(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return toggleHeader('row')(state, dispatch);
	};
}

function toggleHeaderCellOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return toggleHeaderCell(state, dispatch);
	};
}

function mergeOrSplit(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		if (mergeCells(state, dispatch)) {
			return true;
		}

		return splitCell(state, dispatch);
	};
}

/**
 * @fork https://github.com/ProseMirror/prosemirror-tables/blob/67371611fa9964c20d7d8be741f88ea8b3c24900/src/commands.ts#L567
 */
function setCellsAttribute(this: AddCommandsThis, name: string, value: string): Command {
	return ({state, dispatch}) => {
		if (!isInTable(state)) {
			return false;
		}
		const $cell = selectionCell(state);
		// #region REVIEW: CHANGED CODE:
		// If the target cell has an attribute, but the others in the selection do not,
		// then it does not apply the attribute to the others
		// Need delete this logic
		// if ($cell.nodeAfter!.attrs[name] === value) {
		// 	return false;
		// }
		// #endregion
		if (dispatch) {
			const tr = state.tr;
			if (state.selection instanceof CellSelection) {
				state.selection.forEachCell((node, pos) => {
					if (node.attrs[name] !== value) {
						tr.setNodeMarkup(pos, null, {
							...node.attrs,
							[name]: value,
						});
					}
				});
			} else {
				tr.setNodeMarkup($cell.pos, null, {
					...$cell.nodeAfter!.attrs,
					[name]: value,
				});
			}
			dispatch(tr);
		}
		return true;
	};
}

function goToNextCellOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return goToNextCell(1)(state, dispatch);
	};
}

function goToPreviousCellOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		return goToNextCell(-1)(state, dispatch);
	};
}

function fixTablesOverride(this: AddCommandsThis): Command {
	return ({state, dispatch}) => {
		if (dispatch) {
			fixTables(state);
		}

		return true;
	};
}

function setCellSelection(this: AddCommandsThis, position: {anchorCell: number; headCell: number}): Command {
	return ({tr, dispatch}) => {
		if (dispatch) {
			const selection = CellSelection.create(tr.doc, position.anchorCell, position.headCell);
			tr.setSelection(selection);
		}

		return true;
	};
}

export function addCommands(this: AddCommandsThis) {
	return {
		insertTable: insertTable.bind(this),
		addColumnBefore: addColumnBeforeOverride.bind(this),
		setCellSelection: setCellSelection.bind(this),
		fixTables: fixTablesOverride.bind(this),
		goToPreviousCell: goToPreviousCellOverride.bind(this),
		goToNextCell: goToNextCellOverride.bind(this),
		setCellsAttribute: setCellsAttribute.bind(this),
		mergeOrSplit: mergeOrSplit.bind(this),
		toggleHeaderCell: toggleHeaderCellOverride.bind(this),
		toggleHeaderRow: toggleHeaderRow.bind(this),
		toggleHeaderColumn: toggleHeaderColumn.bind(this),
		splitCell: splitCellOverride.bind(this),
		addColumnAfter: addColumnAfterOverride.bind(this),
		deleteColumn: deleteColumnOverride.bind(this),
		addRowBefore: addRowBeforeOverride.bind(this),
		mergeCells: mergeCellsOverride.bind(this),
		deleteTable: deleteTableOverride.bind(this),
		deleteRow: deleteRowOverride.bind(this),
		addRowAfter: addRowAfterOverride.bind(this),
		clearTable: clearTable.bind(this),
	};
}
