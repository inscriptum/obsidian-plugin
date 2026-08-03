import {Extension} from '../../core';

import {bubbleMenuPlugin, BubbleMenuPluginProps} from './bubble-menu-plugin';

export type BubbleMenuOptions = Omit<BubbleMenuPluginProps, 'editor' | 'element'> & {
	element: HTMLElement | null;
};

export const BubbleMenu = Extension.create<BubbleMenuOptions>({
	name: 'bubbleMenu',

	addOptions() {
		return {
			element: null,
			tippyOptions: {},
			pluginKey: 'bubbleMenu',
			updateDelay: undefined,
			shouldShow: null,
			disableHideOnBlur: false,
		};
	},

	addProseMirrorPlugins() {
		if (!this.options.element) {
			return [];
		}

		return [
			bubbleMenuPlugin({
				pluginKey: this.options.pluginKey,
				editor: this.editor,
				element: this.options.element,
				tippyOptions: this.options.tippyOptions,
				updateDelay: this.options.updateDelay,
				shouldShow: this.options.shouldShow,
				disableHideOnBlur: this.options.disableHideOnBlur,
			}),
		];
	},
});
