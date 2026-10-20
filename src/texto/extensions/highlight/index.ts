import type { CommandsSet } from "../../core/@types";
import type { addCommands } from "./commands";
import { Highlight } from "./highlight";

export * from "./highlight";
export default Highlight;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
