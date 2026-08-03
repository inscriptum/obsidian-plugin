import {CommandsSet} from '../../core/@types';

import {addCommands} from './commands';
import {TaskList} from './task-list';

export * from './task-list';

export default TaskList;

declare global {
	interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
