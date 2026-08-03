import {liftEmptyBlock as originalLiftEmptyBlock} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Lift block if empty.
 */
export const liftEmptyBlock =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({state, dispatch}) => {
		return originalLiftEmptyBlock(state, dispatch);
	};
