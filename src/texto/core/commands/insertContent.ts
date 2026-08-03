import type {ParseOptions} from 'prosemirror-model';

import type {Command, Content} from '../@types';

/**
 * Insert a node or string of HTML at the current position.
 */
export function insertContent(
	value: Content,
	options?: {
		parseOptions?: ParseOptions;
		updateSelection?: boolean;
	},
): Command {
	return ({tr, commands}) => {
		return commands.insertContentAt({from: tr.selection.from, to: tr.selection.to}, value, options);
	};
}
