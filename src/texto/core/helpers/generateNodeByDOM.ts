import {type Node as ProsemirrorNode,DOMParser} from 'prosemirror-model';

import type {Extensions} from '../@types';
import {getSchema} from './getSchema';

/**
 * Generate a new ProsemirrorNode from HTML element by schema
 *
 * @param dom - HTML Element
 * @param extensions - schema extensions
 * @returns ProsemirrorNode
 */
export function generateNodeByDOM(dom: HTMLElement, extensions: Extensions): ProsemirrorNode {
	const schema = getSchema(extensions);

	const parser = DOMParser.fromSchema(schema);
	return parser.parse(dom, {preserveWhitespace: 'full'});
}
