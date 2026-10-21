import { CommandsSet } from "../../core/@types";

import { addCommands } from "./commands";

export * from "./hljsCodeBlock";
export * from "./hljsCodeBlockRow";
export * from "./hljsMark";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
