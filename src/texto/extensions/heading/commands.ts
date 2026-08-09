import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  return {
    setHeading:
      (attributes: { level: number }): Command =>
      ({ commands }) => {
        return commands.setNode("heading", attributes);
      },
    toggleHeading:
      (attributes: { level: number }): Command =>
      ({ commands }) => {
        return commands.toggleNode("heading", "paragraph", attributes);
      },
  };
}
