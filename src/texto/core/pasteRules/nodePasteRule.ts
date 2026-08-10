import type {NodeType} from 'prosemirror-model';

import type {AnyRecord, ExtendedRegExpMatchArray} from '../@types';
import {PasteRule} from '../PasteRule';
import {callOrReturn} from '../utilities';

/**
 * Build an paste rule that adds a node when the
 * matched text is pasted into it.
 */
export function nodePasteRule(config: {
	find: RegExp;
	type: NodeType;
	getAttributes?:
		| AnyRecord
		| ((match: ExtendedRegExpMatchArray) => AnyRecord)
		| false
		| null;
}) {
	return new PasteRule({
		find: config.find,
		handler({match, chain, range}): null | void {
			const attributes = callOrReturn(config.getAttributes, undefined, match);

			if (attributes === false || attributes === null) {
				return null;
			}

			if (match.input) {
				chain().deleteRange(range).insertContentAt(range.from, {
					type: config.type.name,
					attrs: attributes,
				});
			}
		},
	});
}
