import type {EditorState} from 'prosemirror-state';

/**
 * @see https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/helpers/isAtStartOfNode.ts
 * The function checks that the element is the first in the node
 * @param state EditorState
 * @param nodeType
 */
export function isAtStartOfNode(state: EditorState) {
	const {$from, $to} = state.selection;

	if ($from.parentOffset > 0 || $from.pos !== $to.pos) {
		return false;
	}

	return true;
}
