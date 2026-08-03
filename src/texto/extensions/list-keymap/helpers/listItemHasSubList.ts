import {getNodeType} from '../../../core';
import {Node} from 'prosemirror-model';
import {EditorState} from 'prosemirror-state';

export const listItemHasSubList = (typeOrName: string, state: EditorState, node?: Node) => {
	if (!node) {
		return false;
	}

	const nodeType = getNodeType(typeOrName, state.schema);

	let hasSubList = false;

	node.descendants((child) => {
		if (child.type === nodeType) {
			hasSubList = true;
		}
	});

	return hasSubList;
};
