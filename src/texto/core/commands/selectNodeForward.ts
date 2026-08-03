import {selectNodeForward as originalSelectNodeForward} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Select a node forward.
 */
export const selectNodeForward =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({state, dispatch}) => {
		return originalSelectNodeForward(state, dispatch);
	};
