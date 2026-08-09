import {generateNodeByDOM} from '../../../core';
import type {JSONContent} from '../../../core/@types';
import {Text} from '../../text';

import {HljsCodeBlockRow} from '../hljsCodeBlockRow';
import {HljsMark} from '../hljsMark';
import {StubHljsCodeBlock} from '../stubHljsCodeBlock';
import {generateCodeBlockDomElement} from './generateCodeBlockDomElement';
import type {SupportedLanguage} from './hljs';

const stubCodeBlockSchema = [
	StubHljsCodeBlock,
	Text,
	HljsCodeBlockRow,
	HljsMark,
];

export function generateHljsNodeJson(
	codeText: string,
	language?: SupportedLanguage,
): JSONContent {
	const codeBlockElement = generateCodeBlockDomElement(codeText, language);

	const codeNode = generateNodeByDOM(codeBlockElement, stubCodeBlockSchema);

	codeBlockElement.remove();

	return codeNode.toJSON() as JSONContent;
}
