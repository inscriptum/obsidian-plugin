import type {MarkType} from 'prosemirror-model';
import {TextSelection} from 'prosemirror-state';

import type {Command} from '../@types';
import {getMarkRange} from '../helpers/getMarkRange';
import {getMarkType} from '../helpers/getMarkType';

/**
 * Extends the text selection to the current mark.
 */
export function extendMarkRange(
	typeOrName: string | MarkType,
	attributes: Record<string, unknown> = {},
): Command {
	return ({tr, state, dispatch}) => {
		const type = getMarkType(typeOrName, state.schema);
		const {doc, selection} = tr;
		const {$from, from, to} = selection;

		if (dispatch) {
			const range = getMarkRange($from, type, attributes);

			if (range && range.from <= from && range.to >= to) {
				const newSelection = TextSelection.create(doc, range.from, range.to);

				tr.setSelection(newSelection);
			}
		}

		return true;
	};
}
