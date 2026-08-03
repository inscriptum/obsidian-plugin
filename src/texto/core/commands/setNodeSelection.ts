import {NodeSelection} from 'prosemirror-state';

import type {Command} from '../@types';
import {minMax} from '../utilities/minMax';

/**
 * Creates a NodeSelection.
 */
export function setNodeSelection(position: number): Command {
	return ({tr, dispatch}) => {
		if (dispatch) {
			const {doc} = tr;
			const from = minMax(position, 0, doc.content.size);
			const selection = NodeSelection.create(doc, from);

			tr.setSelection(selection);
		}

		return true;
	};
}
