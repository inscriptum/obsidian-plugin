import {ResolvedPos} from 'prosemirror-model';
import {EditorState} from 'prosemirror-state';

export function findTableAnchor(
	state: EditorState,
	nodeOffset?: number,
	outerAnchor: ResolvedPos | null = null,
) {
	let anchor = outerAnchor ?? state.selection.$anchor;
	while (anchor.node(nodeOffset).type.name.toLowerCase() !== 'table') {
		// If the table is not found, we returns a null value
		if (anchor.node().type.name.toLowerCase() === 'notedoc') {
			return null;
		}
		anchor = state.doc.resolve(anchor.before());
	}

	return anchor;
}
