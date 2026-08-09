import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  return {
    setBlockquote:
      (): Command =>
      ({ commands }) => {
        return commands.wrapIn("blockquote");
      },
    toggleBlockquote:
      (): Command =>
      ({ commands }) => {
        return commands.toggleWrap("blockquote");
      },
    unsetBlockquote:
      (): Command =>
      ({ commands }) => {
        return commands.lift("blockquote");
      },
  };
}
