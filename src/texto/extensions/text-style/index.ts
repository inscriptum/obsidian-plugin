import type { CommandsSet } from "../../core/@types";
import type { addCommands } from "./commands";
import { TextStyle } from "./text-style";

export * from "./text-style";
export default TextStyle;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
