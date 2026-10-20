import type { CommandsSet } from "../../core/@types";

import { Attachment } from "./attachment";
import type { addAttachmentCommands } from "./commands";

export * from "./attachment";

export default Attachment;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands
    extends CommandsSet<ReturnType<typeof addAttachmentCommands>> {}
}
