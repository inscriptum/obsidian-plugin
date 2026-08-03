import {CommandsSet} from '../../core/@types';

import {addCommands} from './commands';

export * from './hljsCodeBlock';
export * from './hljsCodeBlockRow';
export * from './hljsMark';

declare global {
	interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
