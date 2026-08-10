import type {NodeType} from 'prosemirror-model';

import type {AnyRecord, ExtendedRegExpMatchArray} from '../@types';
import {type InputRuleFinder,InputRule} from '../InputRule';
import {callOrReturn} from '../utilities/callOrReturn';

/**
 * Build an input rule that adds a node when the
 * matched text is typed into it.
 */
export function nodeInputRule(config: {
	find: InputRuleFinder;
	type: NodeType;
	getAttributes?:
		| AnyRecord
		| ((match: ExtendedRegExpMatchArray) => AnyRecord)
		| false
		| null;
}) {
	return new InputRule({
		find: config.find,
		handler: ({state, range, match}) => {
			const attributes = callOrReturn(config.getAttributes, undefined, match) || {};
			const {tr} = state;
			const start = range.from;
			let end = range.to;

			if (match[1]) {
				const offset = match[0].lastIndexOf(match[1]);
				let matchStart = start + offset;

				if (matchStart > end) {
					matchStart = end;
				} else {
					end = matchStart + match[1].length;
				}

				// insert last typed character
				const lastChar = match[0][match[0].length - 1];

				tr.insertText(lastChar, start + match[0].length - 1);

				// insert node from input rule
				tr.replaceWith(matchStart, end, config.type.create(attributes));
			} else if (match[0]) {
				tr.replaceWith(start, end, config.type.create(attributes));
			}
		},
	});
}
