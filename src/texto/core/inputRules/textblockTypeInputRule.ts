import type {NodeType} from 'prosemirror-model';

import type {AnyRecord, ExtendedRegExpMatchArray} from '../@types';
import {type InputRuleFinder,InputRule} from '../InputRule';
import {callOrReturn} from '../utilities/callOrReturn';

/**
 * Build an input rule that changes the type of a textblock when the
 * matched text is typed into it. When using a regular expresion you’ll
 * probably want the regexp to start with `^`, so that the pattern can
 * only occur at the start of a textblock.
 */
export function textblockTypeInputRule(config: {
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
		handler: ({state, range, match}): null | void => {
			const $start = state.doc.resolve(range.from);
			const attributes = callOrReturn(config.getAttributes, undefined, match) || {};

			if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), config.type)) {
				return null;
			}

			state.tr
				.delete(range.from, range.to)
				.setBlockType(range.from, range.from, config.type, attributes);
		},
	});
}
