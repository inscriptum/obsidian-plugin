import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  return {
    setCode:
      (): Command =>
      ({ commands }) => {
        return commands.setMark("code");
      },
    toggleCode:
      (): Command =>
      ({ commands }) => {
        return commands.toggleMark("code");
      },
    unsetCode:
      (): Command =>
      ({ commands }) => {
        return commands.unsetMark("code");
      },
  };
}
