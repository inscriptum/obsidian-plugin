import {Extension} from '../../core';
import {Node} from 'prosemirror-model';
import {Decoration} from 'prosemirror-view';

import {createNodeStatePlugin} from './plugins/nodeState.plugin';

export interface StateOptionsHooks {
	onAdd?: (node: Node, deco: Decoration, meta: {isLocalChange: boolean}) => void;
	onRemove?: (node: Node, deco: Decoration, meta: {isLocalChange: boolean}) => void;
}

export interface StateOptions {
	hooks?: StateOptionsHooks;
	nodeTypes?: string[];
}

export const State = new Extension<StateOptions>({
	name: 'state',
	priority: 2000,

	addGlobalAttributes() {
		return [
			{
				types: this.options.nodeTypes,
				attributes: {
					key: {
						default: null,
						renderHTML: (attributes: { key?: string | null }) => ({
							key: attributes.key,
						}),
						parseHTML: (element) => element.getAttribute('key'),
					},
				},
			},
		];
	},

	addProseMirrorPlugins() {
		const nodeStatePlugin = createNodeStatePlugin(
			new Set(this.options.nodeTypes || []),
			this.editor,
			this.options,
		);
		return [nodeStatePlugin];
	},
});
