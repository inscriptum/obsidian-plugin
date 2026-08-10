import {setBlockType} from 'prosemirror-commands';
import type {NodeType} from 'prosemirror-model';

import type {AnyRecord, Command} from '../@types';
import {getNodeType} from '../helpers/getNodeType';

/**
 * Replace a given range with a node.
 */
export function setNode(typeOrName: string | NodeType, attributes: AnyRecord = {}): Command {
	return ({state, dispatch, chain}) => {
		const type = getNodeType(typeOrName, state.schema);

		// TODO: use a fallback like insertContent?
		if (!type.isTextblock) {
			console.warn('[TEXTO WARN]: Currently "setNode()" only supports text block nodes.');

			return false;
		}

		return (
			chain()
				// try to convert node to default node if needed
				.command(({commands}) => {
					const canSetBlock = setBlockType(type, attributes)(state);

					if (canSetBlock) {
						return true;
					}

					return commands.clearNodes();
				})
				.command(({state: updatedState}) => {
					return setBlockType(type, attributes)(updatedState, dispatch);
				})
				.run()
		);
	};
}
