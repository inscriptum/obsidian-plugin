import type {CommandsSet} from '../../core/@types';

import type {addCommands} from './commands';
import {Image} from './image';

export * from './image';

export default Image;

declare global {
	interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
