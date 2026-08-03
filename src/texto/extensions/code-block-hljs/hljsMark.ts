import {Mark, mergeAttributes} from '../../core';

export interface HljsMarkOptions {
	HTMLAttributes: Record<string, any>;
}

export const HljsMark = Mark.create<HljsMarkOptions>({
	name: 'hljsMark',
	spanning: false,

	// REVIEW: It seems not to work.
	// We see this property in the documentation https://prosemirror.net/docs/ref/#model.MarkSpec.group
	// But the author says:
	// > Marks can’t be configured per node, only per parent node.
	// > I.e. you can disable marks in code blocks, but you can’t disable them only for a specific type of inline element.
	// @see https://discuss.prosemirror.net/t/nodespec-marks-not-work-at-inline-node/2414
	group: 'hljsCodeBlock hljsCodeBlockRow',

	// exclude any other mark
	excludes: '_',

	code: true,

	addOptions() {
		return {
			HTMLAttributes: {},
		};
	},

	addAttributes() {
		return {
			class: {
				default: undefined,
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: 'span[class^="hljs"]',
				preserveWhitespace: true,
			},
		];
	},

	renderHTML({HTMLAttributes}) {
		return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
	},
});
