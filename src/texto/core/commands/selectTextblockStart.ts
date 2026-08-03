import {selectTextblockStart as originalSelectTextblockStart} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Moves the cursor to the start of current text block.
 */
export const selectTextblockStart =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({state, dispatch}) => {
		return originalSelectTextblockStart(state, dispatch);
	};
