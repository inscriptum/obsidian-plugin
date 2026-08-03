import {type Node as ProseMirrorNode, type ParseOptions,Fragment} from 'prosemirror-model';

import type {Command, Content} from '../@types';
import {createDocument} from '../helpers/createDocument';

/**
 * Replace the whole document with new content.
 */
export function setContent(content: Content, emitUpdate = false, parseOptions: ParseOptions = {}): Command {
	return ({tr, editor, dispatch}) => {
		const {doc} = tr;

		let document: Fragment | ProseMirrorNode = Fragment.empty;

		try {
			document = createDocument(content, editor.schema, parseOptions);
		} catch (error) {
			console.warn('[TEXTO WARN]: Invalid content.', 'Passed value:', content, 'Error:', error);
		}

		if (dispatch) {
			tr.replaceWith(0, doc.content.size, document).setMeta('preventUpdate', !emitUpdate);
		}

		return true;
	};
}
