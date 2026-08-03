import type {MarkType} from 'prosemirror-model';

import type {Command} from '../@types';
import {getMarkRange} from '../helpers/getMarkRange';
import {getMarkType} from '../helpers/getMarkType';

/**
 * Remove all marks in the current selection.
 */
export function unsetMark(
	typeOrName: string | MarkType,
	options: {
		/**
		 * Removes the mark even across the current selection. Defaults to `false`.
		 */
		extendEmptyMarkRange?: boolean;
	} = {},
): Command {
	return ({tr, state, dispatch}) => {
		const {extendEmptyMarkRange = false} = options;
		const {selection} = tr;
		const type = getMarkType(typeOrName, state.schema);
		const {$from, empty, ranges} = selection;

		if (!dispatch) {
			return true;
		}

		if (empty && extendEmptyMarkRange) {
			let {from, to} = selection;
			const attrs = $from.marks().find((mark) => mark.type === type)?.attrs;
			const range = getMarkRange($from, type, attrs);

			if (range) {
				from = range.from;
				to = range.to;
			}

			tr.removeMark(from, to, type);
		} else {
			ranges.forEach((range) => {
				tr.removeMark(range.$from.pos, range.$to.pos, type);
			});
		}

		tr.removeStoredMark(type);

		return true;
	};
}
