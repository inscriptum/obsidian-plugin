import type {Node} from 'prosemirror-model';
import {EditorState} from 'prosemirror-state';

import {nodeStatePluginKey, NodeStatePluginSpec} from '../plugins/nodeState.plugin';

/**
 * Find a node position by it's state key
 *
 * @param state - an editor state
 * @param key - state key
 *
 * @returns A position or null if it was not found
 */
export function findPosByKey(state: EditorState, key: string): number | null {
	const decos = nodeStatePluginKey.getState(state);

	if (decos == null) {
		return null;
	}

	const found = decos.find(undefined, undefined, (spec: NodeStatePluginSpec) => {
		return spec.id === key;
	});

	return found.length > 0 ? found[0].from : null;
}

/**
 * Get a node by it's state key
 *
 * @param state - an editor state
 * @param key - state key
 *
 * @returns A node or null if it was not found
 */
export function getNodeByKey(state: EditorState, key: string): Node | null {
	const pos = findPosByKey(state, key);

	return pos != null ? state.doc.nodeAt(pos) : null;
}
