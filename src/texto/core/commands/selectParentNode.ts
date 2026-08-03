import {selectParentNode as originalSelectParentNode} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Select the parent node.
 */
export const selectParentNode =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({state, dispatch}) => {
		return originalSelectParentNode(state, dispatch);
	};
