import type {EditorState} from 'prosemirror-state';

import {findParentNode} from './findParentNode';

/**
 * @see https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/helpers/isAtEndOfNode.ts
 * The function checks that the element is the last in the node
 * @param state EditorState
 * @param nodeType
 */
export function isAtEndOfNode(state: EditorState, nodeType?: string) {
	const {$from, $to, $anchor} = state.selection;

	if (nodeType) {
		const parentNode = findParentNode((node) => node.type.name === nodeType)(state.selection);

		if (!parentNode) {
			return false;
		}

		const $parentPos = state.doc.resolve(parentNode.pos + 1);

		if ($anchor.pos + 1 === $parentPos.end()) {
			return true;
		}

		return false;
	}

	if ($to.parentOffset < $to.parent.nodeSize - 2 || $from.pos !== $to.pos) {
		return false;
	}

	return true;
}
