import { Node } from "../../core";
import { mergeAttributes } from "../../core/utilities";

/**
 * One value of a title-page property row (spec 9.1). A Text property has
 * exactly one of these; a List property stacks several. Values are plain
 * editable lines — Enter adds the next value (turning Text into List),
 * Backspace at the start of an empty value removes it again; the row's
 * keyboard behavior lives on the noteProperty plugin/nodes.
 */
export const NotePropertyValue = Node.create({
  name: "notePropertyValue",

  content: "inline*",

  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "p.note-property-value" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "p",
      mergeAttributes(HTMLAttributes, { class: "note-property-value" }),
      0,
    ];
  },
});
