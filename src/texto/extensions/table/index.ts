import { CommandsSet } from "../../core/@types";

import type { addCommands } from "./commands";
import { Table } from "./table";

export * from "./table";
export * from "./helpers/createColGroup";
export * from "./helpers/createTable";
export * from "./elements/header";
export * from "./elements/row";
export * from "./elements/tableCell";

export default Table;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
