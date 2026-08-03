import type {NodeType} from 'prosemirror-model';

import type {Command} from '../@types';
import {getNodeType} from '../helpers/getNodeType';
import {isNodeActive} from '../helpers/isNodeActive';

/**
 * Toggle a node with another node.
 */
export function toggleNode(
	typeOrName: string | NodeType,
	toggleTypeOrName: string | NodeType,
	attributes: Record<string, any> = {},
): Command {
	return ({state, commands}) => {
		const type = getNodeType(typeOrName, state.schema);
		const toggleType = getNodeType(toggleTypeOrName, state.schema);
		const isActive = isNodeActive(state, type, attributes);

		if (isActive) {
			return commands.setNode(toggleType);
		}

		return commands.setNode(type, attributes);
	};
}
