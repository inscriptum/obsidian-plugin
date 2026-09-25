import { Node } from "../../core";
import { mergeAttributes } from "../../core/utilities";
import type { AnyRecord } from "../../core/@types";

/**
 * The summary line of a title page header (spec 9.1) — the blog draft's
 * topicSummary: a short line under the title with its own placeholder and
 * a field label shown while the header is focused.
 */
export const NoteSummary = Node.create({
  name: "noteSummary",

  content: "inline*",

  defining: true,
  selectable: false,

  addAttributes() {
    return {
      "data-placeholder": {
        default: "Summary of the text",
      },
      "data-label": {
        default: "Summary",
      },
      role: {
        default: "definition",
      },
    };
  },

  parseHTML() {
    return [{ tag: "p" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes), 0];
  },
});

export type NoteSummaryOptions = AnyRecord;
