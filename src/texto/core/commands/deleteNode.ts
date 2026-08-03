import type {NodeType} from 'prosemirror-model';

import type {Command} from '../@types';
import {getNodeType} from '../helpers/getNodeType';

/**
 * Delete a node.
 */
export function deleteNode(typeOrName: string | NodeType): Command {
	return ({tr, state, dispatch}) => {
		const type = getNodeType(typeOrName, state.schema);
		const $pos = tr.selection.$anchor;

		for (let depth = $pos.depth; depth > 0; depth -= 1) {
			const node = $pos.node(depth);

			if (node.type === type) {
				if (dispatch) {
					const from = $pos.before(depth);
					const to = $pos.after(depth);

					tr.delete(from, to).scrollIntoView();
				}

				return true;
			}
		}

		return false;
	};
}
