import type {Node as ProseMirrorNode, ParseOptions, Schema} from 'prosemirror-model';

import type {Content} from '../@types';
import {createNodeFromContent} from './createNodeFromContent';

export function createDocument(
	content: Content,
	schema: Schema,
	parseOptions: ParseOptions = {},
): ProseMirrorNode {
	return createNodeFromContent(content, schema, {
		slice: false,
		parseOptions,
	}) as ProseMirrorNode;
}
