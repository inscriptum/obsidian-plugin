import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

export function addCommands(this: AddCommandsThis) {
  return {
    setColor:
      (color: string): Command =>
      ({ chain }) => {
        return chain().setMark("textStyle", { color }).run();
      },
    unsetColor:
      (): Command =>
      ({ chain }) => {
        return chain()
          .setMark("textStyle", { color: null })
          .removeEmptyTextStyle()
          .run();
      },
  };
}
