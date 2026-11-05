import type { Command, CommandsSet } from "../../core/@types";
import { TextAlign, type TextAlignValue } from "./textAlign";

export * from "./textAlign";
export default TextAlign;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands
    extends CommandsSet<{
      // Command-returning (not boolean): UnionCommands derives both
      // SingleCommands and ChainedCommands from command-typed entries.
      setTextAlign: (align: TextAlignValue | "left") => Command;
    }> {}
}
