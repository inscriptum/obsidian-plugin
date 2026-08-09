import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  return {
    setStrike:
      (): Command =>
      ({ commands }) => {
        return commands.setMark("strike");
      },
    toggleStrike:
      (): Command =>
      ({ commands }) => {
        return commands.toggleMark("strike");
      },
    unsetStrike:
      (): Command =>
      ({ commands }) => {
        return commands.unsetMark("strike");
      },
  };
}
