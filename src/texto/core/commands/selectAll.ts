import type {Command} from '../@types';

/**
 * Select the whole document.
 */
export const selectAll =
	(): Command =>
	({tr, commands}) => {
		return commands.setTextSelection({
			from: 0,
			to: tr.doc.content.size,
		});
	};
