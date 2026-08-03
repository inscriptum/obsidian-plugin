import {joinPoint} from 'prosemirror-transform';

import type {Command} from '../@types';

/**
 * @see https://github.com/ueberdosis/tiptap/blob/1c5c087641162dc9d82814aaa84fcdc267469545/packages/core/src/commands/joinItemBackward.ts
 */
export function joinItemBackward(): Command {
	return ({tr, state, dispatch}) => {
		try {
			const point = joinPoint(state.doc, state.selection.$from.pos, -1);

			if (point == null) {
				return false;
			}

			tr.join(point, 2);

			if (dispatch) {
				dispatch(tr);
			}

			return true;
		} catch {
			return false;
		}
	};
}
