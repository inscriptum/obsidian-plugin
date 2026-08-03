import {CommandsSet} from '../../core/@types';

import {addCommands} from './commands';
import {ListKeymap} from './list-keymap';

export * from './list-keymap';
export * as listHelpers from './helpers/index';

export default ListKeymap;

declare global {
	interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
