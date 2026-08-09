import type {Node, ResolvedPos} from 'prosemirror-model';

export const getTextContentFromNodes = ($from: ResolvedPos, maxMatch = 500) => {
	let textBefore = '';

	const sliceEndPos = $from.parentOffset;

	$from.parent.nodesBetween(
		Math.max(0, sliceEndPos - maxMatch),
		sliceEndPos,
		(node, pos, parent, index) => {
			const toText = node.type.spec.toText as
				| ((props: {node: Node; pos: number; parent: Node | null; index: number}) => string)
				| undefined;
			const chunk =
				toText?.({
					node,
					pos,
					parent,
					index,
				}) ||
				node.textContent ||
				'%leaf%';

			textBefore += chunk.slice(0, Math.max(0, sliceEndPos - pos));
		},
	);

	return textBefore;
};
