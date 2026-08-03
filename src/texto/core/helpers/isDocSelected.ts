import {type EditorState, Selection} from 'prosemirror-state';

/**
 * Check if a whole document was selected (Ctrl+A)
 *
 * @param state an editor state
 * @returns true if a whole document was selected
 */
export function isDocSelected(state: EditorState) {
	const allFrom = Selection.atStart(state.doc).from;
	const allEnd = Selection.atEnd(state.doc).to;

	return state.selection.from === allFrom && state.selection.to === allEnd;
}
