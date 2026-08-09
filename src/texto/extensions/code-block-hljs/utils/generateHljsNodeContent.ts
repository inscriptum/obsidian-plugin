import type {Schema} from 'prosemirror-model';

import {findLanguageByCssClass} from './findLanguageByCssClass';
import {generateHljsNodeJson} from './generateHljsNodeJson';

export function generateHljsNodeContent(
	domNode: HTMLDivElement,
	languageClassPrefix: string,
	textContent: string,
	schema: Schema,
) {
	const codeEl = domNode.querySelector('code');
	const language =
		codeEl != null
			? findLanguageByCssClass(Array.from(codeEl.classList), languageClassPrefix)
			: undefined;

	const codeNodeJson = generateHljsNodeJson(textContent, language);
	const hljsNode = schema.nodeFromJSON(codeNodeJson);

	return hljsNode.content;
}
