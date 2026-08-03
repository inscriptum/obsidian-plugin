import type {CommandsSet} from '../../core/@types';

import {Attachment} from './attachment';
import type {addAttachmentCommands} from './commands';

export * from './attachment';

export default Attachment;

declare global {
	interface Commands extends CommandsSet<ReturnType<typeof addAttachmentCommands>> {}
}
