import {newlineInCode as originalNewlineInCode} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Add a newline character in code.
 */
export const newlineInCode =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({state, dispatch}) => {
		return originalNewlineInCode(state, dispatch);
	};
