import {CommandsSet} from '../../core/@types';

import type {addCommands} from './commands';
import {Table} from './table';

export * from './table';
export * from './helpers/createColGroup';
export * from './helpers/createTable';
export * from './elements/header';
export * from './elements/row';
export * from './elements/tableCell';

export default Table;

declare global {
	interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
