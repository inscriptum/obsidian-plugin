import {mergeAttributes, Node} from '../../../../core';
import type { AnyRecord } from '../../../../core/@types';

export interface TableRowOptions {
	  HTMLAttributes: AnyRecord;
}

export const TableRow = Node.create<TableRowOptions>({
	name: 'tableRow',

	addOptions() {
		return {
			HTMLAttributes: {},
		};
	},

	content: '(tableCell | tableHeader)*',

	tableRole: 'row',

	parseHTML() {
		return [{tag: 'tr'}];
	},

	renderHTML({HTMLAttributes}) {
		return ['tr', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
	},
});
