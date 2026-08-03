import {mergeAttributes, Node} from '../../../../core';

export interface TableHeaderOptions {
	HTMLAttributes: Record<string, any>;
	initWidth: number;
}

export const TableHeader = Node.create<TableHeaderOptions>({
	name: 'tableHeader',

	addOptions() {
		return {
			HTMLAttributes: {},
			initWidth: 50,
		};
	},

	content: 'block+',

	addAttributes() {
		const initWidth = this.options.initWidth;
		return {
			colspan: {
				default: 1,
			},
			rowspan: {
				default: 1,
			},
			colwidth: {
				default: [initWidth],
				parseHTML: (element: HTMLElement) => {
					const colwidth = element.dataset['colwidth'];
					return colwidth ? [parseInt(colwidth)] : [initWidth];
				},
				renderHTML: (attributes) => ({
					['data-colwidth']: attributes?.colwidth ? attributes.colwidth : [initWidth],
				}),
			},
			dataColor: {
				default: null,
				renderHTML: (attributes) => {
					if (!attributes.dataColor) {
						return {};
					}

					return {
						['data-color']: attributes.dataColor,
					};
				},
				parseHTML: (element) => {
					const dataColor = element.dataset['color'];
					return dataColor ? [dataColor] : [];
				},
			},
			backgroundColor: {
				default: null,
				renderHTML: (attributes) => {
					if (!attributes.backgroundColor) {
						return {};
					}

					return {
						style: `background-color: ${attributes.backgroundColor} !important`,
					};
				},
				parseHTML: (element) => {
					return element.style.backgroundColor;
				},
			},
		};
	},

	tableRole: 'header_cell',

	isolating: true,

	parseHTML() {
		return [{tag: 'th'}];
	},

	renderHTML({HTMLAttributes}) {
		return ['th', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
	},
});
