import type {NodeType} from 'prosemirror-model';
import {sinkListItem as originalSinkListItem} from 'prosemirror-schema-list';

import type {Command} from '../@types';
import {getNodeType} from '../helpers/getNodeType';

/**
 * Sink the list item down into an inner list.
 */
export function sinkListItem(typeOrName: string | NodeType): Command {
	return ({state, dispatch}) => {
		const type = getNodeType(typeOrName, state.schema);

		return originalSinkListItem(type)(state, dispatch);
	};
}
