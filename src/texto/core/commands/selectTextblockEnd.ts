import {selectTextblockEnd as originalSelectTextblockEnd} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Moves the cursor to the end of current text block.
 */
export const selectTextblockEnd =
	(): Command =>
	({state, dispatch}) => {
		return originalSelectTextblockEnd(state, dispatch);
	};
