import type { CommandsSet } from "../../core/@types";
import type { addCommands } from "./commands";
import { HorizontalRule } from "./horizontal-rule";

export * from "./horizontal-rule";
export default HorizontalRule;

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
