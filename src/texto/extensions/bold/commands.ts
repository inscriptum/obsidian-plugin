import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  return {
    setBold:
      (): Command =>
      ({ commands }) => {
        return commands.setMark("bold");
      },
    toggleBold:
      (): Command =>
      ({ commands }) => {
        return commands.toggleMark("bold");
      },
    unsetBold:
      (): Command =>
      ({ commands }) => {
        return commands.unsetMark("bold");
      },
  };
}
