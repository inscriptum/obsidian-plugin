import type {MarkType} from 'prosemirror-model';

import type {AnyRecord, Command} from '../@types';
import {getMarkType} from '../helpers/getMarkType';
import {isMarkActive} from '../helpers/isMarkActive';

/**
 * Toggle a mark on and off.
 */
export function toggleMark(
	typeOrName: string | MarkType,
	attributes: AnyRecord = {},
	options: {
		/**
		 * Removes the mark even across the current selection. Defaults to `false`.
		 */
		extendEmptyMarkRange?: boolean;
	} = {},
): Command {
	return ({state, commands}) => {
		const {extendEmptyMarkRange = false} = options;
		const type = getMarkType(typeOrName, state.schema);
		const isActive = isMarkActive(state, type, attributes);

		if (isActive) {
			return commands.unsetMark(type, {extendEmptyMarkRange});
		}

		return commands.setMark(type, attributes);
	};
}
