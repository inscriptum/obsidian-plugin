import { CommandsSet } from "../../core/@types";

import { addCommands } from "./commands";
import { ListKeymap } from "./list-keymap";

export * from "./list-keymap";
export * as listHelpers from "./helpers/index";

export default ListKeymap;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
