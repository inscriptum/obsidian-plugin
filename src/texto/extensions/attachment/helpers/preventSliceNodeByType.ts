import {Fragment, Slice} from 'prosemirror-model';

/**
 * Clear a Slice instance from specific node
 *
 * @param typeName a node's type name which we don't want to have inside a slice
 * @param slice the slice instance
 * @returns
 */
export function preventSliceNodeByType(typeName: string, slice: Slice) {
	let hasAttachments = false;

	slice.content.forEach((node) => {
		if (node.type.name === typeName) {
			hasAttachments = true;
		}
	});

	return hasAttachments ? new Slice(Fragment.fromArray([]), 0, 0) : slice;
}
