import type {NodeConfig} from '../@types/NodeConfig';
import {Node} from '../Node';

/**
 * Create a stub node extension based on a real node config
 *
 * @param config - a stubbed node config
 * @param htmlTag - a stub
 * @returns stubbing node
 */
export function createStubNodeExt(config: NodeConfig, htmlTag = 'texto-stub') {
	return Node.create({
		...config,

		selectable: false,
		draggable: false,
		defining: false,

		parseHTML() {
			return [{tag: htmlTag}];
		},

		renderHTML({HTMLAttributes}) {
			return [htmlTag, HTMLAttributes];
		},

		addCommands: undefined,
		addProseMirrorPlugins: undefined,
		addNodeView: undefined,
	});
}
