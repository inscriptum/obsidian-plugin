import type {NodeType} from 'prosemirror-model';
import {wrapInList as originalWrapInList} from 'prosemirror-schema-list';

import type {Command} from '../@types';
import {getNodeType} from '../helpers/getNodeType';

/**
 * Wrap a node in a list.
 */
export function wrapInList(typeOrName: string | NodeType, attributes: Record<string, any> = {}): Command {
	return ({state, dispatch}) => {
		const type = getNodeType(typeOrName, state.schema);

		return originalWrapInList(type, attributes)(state, dispatch);
	};
}
