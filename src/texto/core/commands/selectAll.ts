import type {Command} from '../@types';

/**
 * Select the whole document.
 */
export const selectAll =
	(): Command =>
	// eslint-disable-next-line unicorn/consistent-function-scoping
	({tr, commands}) => {
		return commands.setTextSelection({
			from: 0,
			to: tr.doc.content.size,
		});
	};
