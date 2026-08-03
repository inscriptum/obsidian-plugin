import type {Command} from '../@types';

/**
 * Clear the whole document.
 */
export function clearContent(emitUpdate = false): Command {
	return ({commands}) => {
		return commands.setContent('', emitUpdate);
	};
}
