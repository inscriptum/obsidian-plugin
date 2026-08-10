import type {MarkType, NodeType} from 'prosemirror-model';
import type {EditorState} from 'prosemirror-state';

import type {AnyRecord} from '../@types';
import {getMarkAttributes} from './getMarkAttributes';
import {getNodeAttributes} from './getNodeAttributes';
import {getSchemaTypeNameByName} from './getSchemaTypeNameByName';

export function getAttributes(
	state: EditorState,
	typeOrName: string | NodeType | MarkType,
): AnyRecord {
	const schemaType = getSchemaTypeNameByName(
		typeof typeOrName === 'string' ? typeOrName : typeOrName.name,
		state.schema,
	);

	if (schemaType === 'node') {
		return getNodeAttributes(state, typeOrName as NodeType);
	}

	if (schemaType === 'mark') {
		return getMarkAttributes(state, typeOrName as MarkType);
	}

	return {};
}
