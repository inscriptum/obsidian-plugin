import { Mark, mergeAttributes } from "../../core";

/**
 * The comment anchor is a mark carrying the thread id, not a positional
 * annotation: the range is anchored to the text and survives edits,
 * copy/paste and undo/redo like any mark. Thread data lives outside the document keyed
 * by the `id` attribute.
 *
 * The mark itself renders NEUTRALLY (`span[data-comment-id]`): the editor
 * highlight comes from the comments plugin's decoration, so stored documents
 * and the website export (a schema without the plugin) show a plain span.
 * The .note profile does not register this mark — HTML clipboard from a .um
 * editor loses it silently there, which is the owner's decision for v1.
 */
export const CommentMark = Mark.create({
  name: "comment",

  // Typing right after the anchor must not extend it; edits inside the
  // range still stretch it (standard non-inclusive mark behavior).
  inclusive: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-id"),
        renderHTML: (attributes: { id?: string | null }) => {
          if (!attributes.id) return {};
          return { "data-comment-id": attributes.id };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-comment-id]",
        getAttrs: (element) => ({
          id: element.getAttribute("data-comment-id"),
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});
