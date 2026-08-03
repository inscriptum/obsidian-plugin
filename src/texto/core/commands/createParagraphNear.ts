import {createParagraphNear as originalCreateParagraphNear} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Create a paragraph nearby.
 */
export function createParagraphNear(): Command {
	return ({state, dispatch}) => {
		return originalCreateParagraphNear(state, dispatch);
	};
}
