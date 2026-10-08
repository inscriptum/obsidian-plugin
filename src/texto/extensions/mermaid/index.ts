import type { CommandsSet } from "../../core/@types";

import type { addCommands } from "./commands";
import { Mermaid } from "./mermaid";

export * from "./mermaid";

export default Mermaid;

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
