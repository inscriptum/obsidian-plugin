import { Mark, mergeAttributes } from "../../core";

/**
 * A committed internal link (owner direction, wikilinks round 7): the same
 * pattern as bold — the raw «[[target|label]]» syntax exists only while the
 * link is being created (the suggest session); on commit it is consumed and
 * the document stores the label text carrying this mark, the target riding
 * the mark attrs. Re-entering the link offers only the label for editing —
 * the inside is fixed. The same shape the experimental round-1/2 builds
 * wrote, so those documents open natively again.
 */
export interface WikiLinkMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const WikiLinkMark = Mark.create<WikiLinkMarkOptions>({
  name: "wikiLink",

  /** Typing right at the edge of a committed label must not extend the
   *  link — the label is edited from inside, the mark does not creep. */
  inclusive: false,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [{ tag: "span[data-wiki-path]" }];
  },

  addAttributes() {
    return {
      // The vault path renders as data-wiki-path (the hook the hover menu
      // and click handlers read); the attr itself must not leak into the
      // DOM as `path="…"`.
      path: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-wiki-path") ?? "",
        renderHTML: (attributes: { path?: unknown }) => ({
          "data-wiki-path": typeof attributes.path === "string" ? attributes.path : "",
        }),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: "texto-wikilink" }), 0];
  },
});
