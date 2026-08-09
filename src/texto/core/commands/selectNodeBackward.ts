import {selectNodeBackward as originalSelectNodeBackward} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Select a node backward.
 */
export const selectNodeBackward =
	(): Command =>
	({state, dispatch}) => {
		return originalSelectNodeBackward(state, dispatch);
	};
