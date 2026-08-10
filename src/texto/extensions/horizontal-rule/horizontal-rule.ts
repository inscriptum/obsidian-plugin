import { mergeAttributes, Node, nodeInputRule } from "../../core";
import type { AnyRecord } from "../../core/@types";
import { addCommands } from "./commands";

export interface HorizontalRuleOptions {
  HTMLAttributes: AnyRecord;
}

export const HorizontalRule = Node.create<HorizontalRuleOptions>({
  name: "horizontalRule",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  group: "block",

  parseHTML() {
    return [{ tag: "hr" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["hr", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addCommands,

  addKeyboardShortcuts() {
    return {
      "Mod-Alt--": () => this.editor.commands.setHorizontalRule(),
    };
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /^(?:---|—-|___\s|\*\*\*\s)$/,
        type: this.type,
      }),
    ];
  },
});
