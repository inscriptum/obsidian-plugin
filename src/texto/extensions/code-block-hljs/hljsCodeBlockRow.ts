import {mergeAttributes, Node} from '../../core';
import type { AnyRecord } from '../../core/@types';

export interface HljsCodeBlockRowOptions {
	HTMLAttributes: AnyRecord;
}

export const HljsCodeBlockRow = Node.create<HljsCodeBlockRowOptions>({
	name: 'hljsCodeBlockRow',

	group: 'hljsCodeBlock',

	content: 'inline*',

	marks: 'hljsMark',

	addOptions() {
		return {
			HTMLAttributes: {},
		};
	},

	addAttributes() {
		return {
			class: {
				default: 'l',
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: 'div.l',
				preserveWhitespace: 'full',
				attrs: {
					class: 'l',
				},
			},
		];
	},

	renderHTML({HTMLAttributes}) {
		return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
	},
});
