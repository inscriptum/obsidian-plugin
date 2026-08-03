import type {Command} from '../@types';

/**
 * Trigger enter.
 */
export function enter(): Command {
	return ({commands}) => {
		return commands.keyboardShortcut('Enter');
	};
}
