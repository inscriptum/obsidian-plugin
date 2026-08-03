import type {MarkType, NodeType} from 'prosemirror-model';

import type {Command} from '../@types';
import {getMarkType} from '../helpers/getMarkType';
import {getNodeType} from '../helpers/getNodeType';
import {getSchemaTypeNameByName} from '../helpers/getSchemaTypeNameByName';
import {deleteProps} from '../utilities/deleteProps';

/**
 * Resets some node attributes to the default value.
 */
export function resetAttributes(
	typeOrName: string | NodeType | MarkType,
	attributes: string | string[],
): Command {
	// eslint-disable-next-line sonarjs/cognitive-complexity
	return ({tr, state, dispatch}) => {
		let nodeType: NodeType | null = null;
		let markType: MarkType | null = null;

		const schemaType = getSchemaTypeNameByName(
			typeof typeOrName === 'string' ? typeOrName : typeOrName.name,
			state.schema,
		);

		if (!schemaType) {
			return false;
		}

		if (schemaType === 'node') {
			nodeType = getNodeType(typeOrName as NodeType, state.schema);
		}

		if (schemaType === 'mark') {
			markType = getMarkType(typeOrName as MarkType, state.schema);
		}

		if (dispatch) {
			tr.selection.ranges.forEach((range) => {
				state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
					if (nodeType && nodeType === node.type) {
						tr.setNodeMarkup(pos, undefined, deleteProps(node.attrs, attributes));
					}

					if (markType && node.marks.length) {
						node.marks.forEach((mark) => {
							if (markType === mark.type) {
								tr.addMark(
									pos,
									pos + node.nodeSize,
									markType.create(deleteProps(mark.attrs, attributes)),
								);
							}
						});
					}
				});
			});
		}

		return true;
	};
}
