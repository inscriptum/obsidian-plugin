import type {NodeType} from 'prosemirror-model';
import {liftListItem as originalLiftListItem} from 'prosemirror-schema-list';

import type {Command} from '../@types';
import {getNodeType} from '../helpers/getNodeType';

/**
 * Lift the list item into a wrapping list.
 */
export function liftListItem(typeOrName: string | NodeType): Command {
	return ({state, dispatch}) => {
		const type = getNodeType(typeOrName, state.schema);

		return originalLiftListItem(type)(state, dispatch);
	};
}
