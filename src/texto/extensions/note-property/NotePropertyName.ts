import { Node } from "../../core";
import { mergeAttributes } from "../../core/utilities";

/**
 * The name field of a title-page property row (spec 9.1): a short line of
 * plain text identifying the property. Any name is valid — the preset
 * suggestions (see noteProperty.plugin) are an input aid, not a
 * restriction. Rendering and row behavior live on the `noteProperty`
 * parent and its plugin; this node only carries the editable text.
 */
export const NotePropertyName = Node.create({
  name: "notePropertyName",

  content: "inline*",

  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "div.note-property-name" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "note-property-name" }),
      0,
    ];
  },
});
