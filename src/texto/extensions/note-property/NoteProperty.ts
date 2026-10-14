import { Node } from "../../core";
import { mergeAttributes } from "../../core/utilities";

/**
 * A title-page property row (spec 9.1): the `name` field plus one or more
 * value rows. Stored in the title-page document itself — after the title
 * node, before the content blocks (TitleDoc's content expression). The
 * row's keyboard behavior and its UI affordances (placeholders, remove
 * button, add-row button, name autocomplete) live in noteProperty.plugin;
 * the storage-level JSON shape lives in src/storage/um/umSchemas.ts.
 */
export const NoteProperty = Node.create({
  name: "noteProperty",

  group: "block",

  content: "notePropertyName notePropertyValue+",

  defining: true,
  selectable: false,

  addAttributes() {
    return {
      /** "text" — exactly one value; "list" — one or more values. */
      type: {
        default: "text",
        parseHTML: (element) =>
          element.getAttribute("data-property-type") === "list"
            ? "list"
            : "text",
        renderHTML: (attributes) => ({
          "data-property-type": attributes.type === "list" ? "list" : "text",
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div.note-property" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "note-property" }),
      0,
    ];
  },
});
