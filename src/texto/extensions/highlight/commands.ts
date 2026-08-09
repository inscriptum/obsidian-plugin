import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  return {
    setHighlight:
      (attributes?: { color: string }): Command =>
      ({ commands }) => {
        return commands.setMark("highlight", attributes);
      },
    toggleHighlight:
      (attributes?: { color: string }): Command =>
      ({ commands }) => {
        return commands.toggleMark("highlight", attributes);
      },
    unsetHighlight:
      (): Command =>
      ({ commands }) => {
        return commands.unsetMark("highlight");
      },
  };
}
