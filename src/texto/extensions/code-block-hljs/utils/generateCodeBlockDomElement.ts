import type {HighlightResult} from 'highlight.js';

import hljs, {type SupportedLanguage, LANGUAGES} from './hljs';

export function generateCodeBlockDomElement(codeText: string, language?: SupportedLanguage) {
	let hljsResult: HighlightResult | undefined = undefined;

	codeText = codeText.replace(/\r\n?/g, '\n');

	if (typeof language === 'string') {
		hljsResult = hljs.highlight(codeText, {language});
	} else {
		hljsResult = hljs.highlightAuto(codeText, [...LANGUAGES]);
	}

	const codeLineList = hljsResult.value.split('\n');

	let codeRows = '';
	const preElement = document.createElement('pre');

	const openedTagsReg = /<\w+/gi;
	const closedTagsReg = /\/\w*>/gi;

	let cachedLines: {
		lines: string[];
		openedTagsCount: number;
		closedTagsCount: number;
	} | null = null;
	let openedTagsCount = 0;
	let closedTagsCount = 0;
	let lines: string[] = [];

	for (let codeLine of codeLineList) {
		codeLine = codeLine || '';
		// If there is something in cached lines use it
		if (cachedLines != null) {
			openedTagsCount = cachedLines.openedTagsCount;
			closedTagsCount = cachedLines.closedTagsCount;
			cachedLines.lines.push(codeLine);
		} else {
			openedTagsCount = 0;
			closedTagsCount = 0;
			lines = [codeLine];
		}

		// Count opening tags in the line
		openedTagsCount += codeLine.match(openedTagsReg)?.length ?? 0;
		// Count closing tags in the line
		closedTagsCount += codeLine.match(closedTagsReg)?.length ?? 0;

		// If a count of opened tags is greater than closed, then cache it for the next processing
		if (openedTagsCount > closedTagsCount) {
			cachedLines = {
				openedTagsCount,
				closedTagsCount,
				lines,
			};
		} else if (cachedLines != null) {
			// Process cached lines
			codeRows += createNewCodeRow(cachedLines.lines);
			cachedLines = null;
		} else {
			codeRows += `<div class="l">${lines.join('\n')}</div>`;
		}
	}

	preElement.appendChild(parseCodeRows(codeRows));

	return preElement;
}

/**
 * Parses the highlight.js-generated HTML into DOM nodes without using
 * `innerHTML` (trusted input — highlight.js escapes the code text).
 */
function parseCodeRows(codeRows: string): DocumentFragment {
	const parsed = new DOMParser().parseFromString(`<div>${codeRows}</div>`, 'text/html');
	const rows = parsed.body.firstElementChild;
	const fragment = document.createDocumentFragment();

	if (rows) {
		while (rows.firstChild) {
			fragment.appendChild(rows.firstChild);
		}
	}

	return fragment;
}

function createNewCodeRow(lines: string[]) {
	const line = lines.join('\n');
	const openTag = line.match(/<[^<>/]*?>/i)?.[0];
	const closeTag = line.match(/<\/[^<>/]*?>/i)?.[0];

	let row = '';

	if (openTag != null && closeTag != null) {
		lines.forEach((it, i) => {
			if (i === 0) {
				row += createCodeLine(`${it}${closeTag}`);
			} else if (i === lines.length - 1) {
				row += createCodeLine(`${openTag}${it}`);
			} else {
				row += createCodeLine(`${openTag}${it}${closeTag}`);
			}
		});
	} else {
		row += createCodeLine(line);
	}

	return row;
}

function createCodeLine(content: string) {
	return `<div class="l">${content}</div>`;
}
