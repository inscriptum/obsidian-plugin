import {joinPoint} from 'prosemirror-transform';

import type {Command} from '../@types';

/**
 * @see https://github.com/ueberdosis/tiptap/blob/1c5c087641162dc9d82814aaa84fcdc267469545/packages/core/src/commands/joinItemForward.ts
 */
export function joinItemForward(): Command {
	return ({
		state,
		dispatch,
		tr,
		// eslint-disable-next-line unicorn/consistent-function-scoping
	}) => {
		try {
			const point = joinPoint(state.doc, state.selection.$from.pos, +1);

			if (point == null) {
				return false;
			}

			tr.join(point, 2);

			if (dispatch) {
				dispatch(tr);
			}

			return true;
		} catch (error) {
			return false;
		}
	};
}
