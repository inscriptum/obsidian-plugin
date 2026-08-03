import type {Node as ProseMirrorNode, ResolvedPos} from 'prosemirror-model';

import type {Predicate} from '../@types';

/**
 * Find a parent node by a predicate in a given position
 *
 * @param $pos - position
 * @param predicate - a condition to check a parent node
 */
export function findParentNodeClosestToPos(
	$pos: ResolvedPos,
	predicate: Predicate,
): {
	pos: number;
	start: number;
	depth: number;
	node: ProseMirrorNode;
} | void {
	for (let i = $pos.depth; i > 0; i -= 1) {
		const node = $pos.node(i);

		if (predicate(node)) {
			return {
				pos: i > 0 ? $pos.before(i) : 0,
				start: $pos.start(i),
				depth: i,
				node,
			};
		}
	}
}
