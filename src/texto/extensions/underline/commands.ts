import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  return {
    setUnderline:
      (): Command =>
      ({ commands }) => {
        return commands.setMark("underline");
      },
    toggleUnderline:
      (): Command =>
      ({ commands }) => {
        return commands.toggleMark("underline");
      },
    unsetUnderline:
      (): Command =>
      ({ commands }) => {
        return commands.unsetMark("underline");
      },
  };
}
