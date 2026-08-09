import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  return {
    setItalic:
      (): Command =>
      ({ commands }) => {
        return commands.setMark("italic");
      },
    toggleItalic:
      (): Command =>
      ({ commands }) => {
        return commands.toggleMark("italic");
      },
    unsetItalic:
      (): Command =>
      ({ commands }) => {
        return commands.unsetMark("italic");
      },
  };
}
