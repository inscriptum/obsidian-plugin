import { Mark, mergeAttributes } from "../../core";
import type { AnyRecord } from "../../core/@types";
import { addCommands } from "./commands";

export interface TextStyleOptions {
  HTMLAttributes: AnyRecord;
}

export const TextStyle = Mark.create<TextStyleOptions>({
  name: "textStyle",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (element) => {
          const hasStyles = element.hasAttribute("style");

          if (!hasStyles) {
            return false;
          }

          return {};
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands,
});
