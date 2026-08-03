import {lift as originalLift} from 'prosemirror-commands';
import type {NodeType} from 'prosemirror-model';

import type {Command} from '../@types';
import {getNodeType} from '../helpers/getNodeType';
import {isNodeActive} from '../helpers/isNodeActive';

/**
 * Removes an existing wrap.
 */
export function lift(typeOrName: string | NodeType, attributes: Record<string, any> = {}): Command {
	return ({state, dispatch}) => {
		const type = getNodeType(typeOrName, state.schema);
		const isActive = isNodeActive(state, type, attributes);

		if (!isActive) {
			return false;
		}

		return originalLift(state, dispatch);
	};
}
