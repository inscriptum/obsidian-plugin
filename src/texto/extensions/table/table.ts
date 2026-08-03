import {callOrReturn, getExtensionField, mergeAttributes, Node} from '../../core';
import {NodeConfig} from '../../core/@types/NodeConfig';
import {columnResizing, tableEditing} from 'prosemirror-tables';
import {NodeView} from 'prosemirror-view';

import {addCommands} from './commands';
import {deleteTableWhenAllCellsSelected} from './helpers';
import {createColGroup} from './helpers/createColGroup';
import {handleCellSelection} from './helpers/handleCellSelection';
import {TableView} from './tableView';

interface TableOptions {
	HTMLAttributes: Record<string, any>;
	resizable: boolean;
	handleWidth: number;
	cellMinWidth: number;
	View: NodeView;
	lastColumnResizable: boolean;
	allowTableNodeSelection: boolean;
	isMobileView: boolean;
}

export const Table = Node.create<TableOptions>({
	name: 'table',

	addOptions() {
		return {
			HTMLAttributes: {},
			resizable: false,
			handleWidth: 5,
			cellMinWidth: 25,
			// TODO: deleted as ...
			View: TableView as unknown as NodeView,
			lastColumnResizable: true,
			allowTableNodeSelection: false,
			isMobileView: false,
		};
	},

	addAttributes() {
		return {
			data: {
				parseHTML: (element: HTMLElement) => ({
					rowsCount: element.dataset['rowsCount'],
					colsCount: element.dataset['colsCount'],
				}),
				renderHTML: (attributes) => ({
					[`data-rowsCount`]: attributes.data?.rowsCount,
					[`data-colsCount`]: attributes.data?.colsCount,
				}),
			},
		};
	},

	content: 'tableRow+',

	tableRole: 'table',

	isolating: true,

	group: 'block',

	parseHTML() {
		return [{tag: 'table'}];
	},

	renderHTML({node, HTMLAttributes}) {
		const {colgroup, tableWidth, tableMinWidth} = createColGroup(node, this.options.cellMinWidth);

		return [
			'div',
			{
				class: 'table-wrapper',
			},
			[
				'table',
				mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
					style: tableWidth ? `width: ${tableWidth}` : `minWidth: ${tableMinWidth}`,
				}),
				colgroup,
				['tbody', 0],
			],
		];
	},

	addCommands,

	addKeyboardShortcuts() {
		return {
			Tab: () => {
				if (this.editor.commands.goToNextCell()) {
					return true;
				}

				if (!this.editor.can().addRowAfter()) {
					return false;
				}

				return this.editor.chain().addRowAfter().goToNextCell().run();
			},
			'Shift-Tab': () => this.editor.commands.goToPreviousCell(),
			Backspace: deleteTableWhenAllCellsSelected,
			'Mod-Backspace': deleteTableWhenAllCellsSelected,
			Delete: deleteTableWhenAllCellsSelected,
			'Mod-Delete': deleteTableWhenAllCellsSelected,
		};
	},

	addProseMirrorPlugins() {
		const isResizable = this.options.resizable && this.editor.isEditable;
		const isMobileView = this.options.isMobileView;

		return [
			handleCellSelection(isMobileView),
			...(isResizable
				? [
						columnResizing({
							handleWidth: this.options.handleWidth,
							cellMinWidth: this.options.cellMinWidth,
							View: this.options.View,
							lastColumnResizable: this.options.lastColumnResizable,
							// TODO: delete as ...
						} as unknown as Parameters<typeof columnResizing>[0]),
				  ]
				: []),
			tableEditing({
				allowTableNodeSelection: this.options.allowTableNodeSelection,
			}),
		];
	},

	extendNodeSchema(this, extension) {
		const context = {
			name: this.name,
			options: this.options,
			storage: this.storage,
		};

		return {
			tableRole: callOrReturn(getExtensionField(extension, 'tableRole', context)),
		};
	},
});
