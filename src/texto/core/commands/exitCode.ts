import {exitCode as originalExitCode} from 'prosemirror-commands';

import type {Command} from '../@types';

/**
 * Exit from a code block.
 */
export function exitCode(): Command {
	return ({state, dispatch}) => {
		return originalExitCode(state, dispatch);
	};
}
