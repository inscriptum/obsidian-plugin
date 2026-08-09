import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  return {
    setParagraph:
      (): Command =>
      ({ commands }) => {
        return commands.setNode("paragraph");
      },
  };
}
