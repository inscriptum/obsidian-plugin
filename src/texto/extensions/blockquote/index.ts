import type { CommandsSet } from "../../core/@types";
import type { addCommands } from "./commands";
import { Blockquote } from "./blockquote";

export * from "./blockquote";
export default Blockquote;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
