import type {NodeType} from 'prosemirror-model';
import {wrapInList as originalWrapInList} from 'prosemirror-schema-list';

import type {AnyRecord, Command} from '../@types';
import {getNodeType} from '../helpers/getNodeType';

/**
 * Wrap a node in a list.
 */
export function wrapInList(typeOrName: string | NodeType, attributes: AnyRecord = {}): Command {
	return ({state, dispatch}) => {
		const type = getNodeType(typeOrName, state.schema);

		return originalWrapInList(type, attributes)(state, dispatch);
	};
}
