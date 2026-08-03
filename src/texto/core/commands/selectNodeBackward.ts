import {selectNodeBackward as originalSelectNodeBackward} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Select a node backward.
 */
export const selectNodeBackward =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({state, dispatch}) => {
		return originalSelectNodeBackward(state, dispatch);
	};
