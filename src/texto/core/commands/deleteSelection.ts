import {deleteSelection as originalDeleteSelection} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Delete the selection, if there is one.
 */
export function deleteSelection(): Command {
	return ({state, dispatch}) => {
		return originalDeleteSelection(state, dispatch);
	};
}
