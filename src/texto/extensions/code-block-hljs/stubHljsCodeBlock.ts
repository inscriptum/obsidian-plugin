import {Node} from '../../core';

import {HljsCodeBlockOptions} from './hljsCodeBlock';

export const StubHljsCodeBlock = Node.create<HljsCodeBlockOptions>({
	name: 'hljsCodeBlock',
	content: 'hljsCodeBlockRow+',
	topNode: true,

	parseHTML() {
		return [
			{
				preserveWhitespace: 'full',
				tag: 'pre',
			},
		];
	},

	renderHTML({HTMLAttributes}) {
		return ['pre', this.options.HTMLAttributes, ['code', HTMLAttributes, 0]];
	},
});
