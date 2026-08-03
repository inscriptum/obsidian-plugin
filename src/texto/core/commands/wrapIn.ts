import {wrapIn as originalWrapIn} from 'prosemirror-commands';
import type {NodeType} from 'prosemirror-model';

import type {Command} from '../@types';
import {getNodeType} from '../helpers/getNodeType';

/**
 * Wraps nodes in another node.
 */
export function wrapIn(typeOrName: string | NodeType, attributes: Record<string, any> = {}): Command {
	return ({state, dispatch}) => {
		const type = getNodeType(typeOrName, state.schema);

		return originalWrapIn(type, attributes)(state, dispatch);
	};
}
