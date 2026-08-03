import type {NodeType} from 'prosemirror-model';

import type {Command} from '../@types';
import {getNodeType} from '../helpers/getNodeType';
import {isNodeActive} from '../helpers/isNodeActive';

/**
 * Wraps nodes in another node, or removes an existing wrap.
 */
export function toggleWrap(typeOrName: string | NodeType, attributes: Record<string, any> = {}): Command {
	return ({state, commands}) => {
		const type = getNodeType(typeOrName, state.schema);
		const isActive = isNodeActive(state, type, attributes);

		if (isActive) {
			return commands.lift(type);
		}

		return commands.wrapIn(type, attributes);
	};
}
