import { Node, mergeAttributes } from "../../core";

/**
 * A committed internal link (owner direction, wikilinks round 7 review):
 * an INLINE ATOM node — the owner's «Способ 1». The whole link is one
 * opaque unit: ProseMirror never places the caret inside it (arrows jump
 * over it, backspace deletes it whole), which kills the entire class of
 * caret-between-icon-and-text artifacts at the schema level. The label
 * lives in the `text` attr; inline label editing goes through the hover
 * menu's «Редактировать» (dissolves back into the raw «[[…]]» syntax).
 *
 * Storage shape: { type: "wikiLink", attrs: { path, text } } — additive
 * dictionary extension; documents from every earlier generation convert
 * on read (see legacyMarks.ts).
 */
export interface WikiLinkNodeOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const WikiLinkNode = Node.create<WikiLinkNodeOptions>({
  name: "wikiLink",

  inline: true,
  group: "inline",
  atom: true,

  /** Keep the link whole across block splits and edits. */
  draggable: false,

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
          "data-wiki-path":
            typeof attributes.path === "string" ? attributes.path : "",
        }),
      },
      // The visible label («|display» when the link was created; the file
      // basename otherwise).
      text: {
        default: "",
        parseHTML: (element: HTMLElement) => element.textContent ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    // contenteditable=false: the browser must never place a caret inside
    // the atom (PM keeps atom positions outside it anyway).
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: "texto-wikilink",
        contenteditable: "false",
      }),
      String(node.attrs.text ?? ""),
    ];
  },
});
