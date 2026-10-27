import { Mark, mergeAttributes } from "../../core";
import type { EditorView } from "prosemirror-view";
import type { Mark as PMMark } from "prosemirror-model";

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
    // Serialization-only shape (export, clipboard): the trailing icon is
    // added at edit time by WikiLinkMarkView and must not leak into
    // stored/published HTML.
    return ["span", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: "texto-wikilink" }), 0];
  },
});

/**
 * The edit-time mark view (owner direction, ProseMirror level): the label
 * lives in `contentDOM` (PM-managed, editable), the document icon is a
 * SIBLING after it — outside contentDOM, non-editable, pointer-transparent.
 * The caret can therefore never land between the label and the icon: PM
 * maps positions into contentDOM only, and the caret at the mark's edge
 * renders outside the whole wrapper. No hiding, no layout toggles — the
 * structure is static, so focus changes cannot reflow the line.
 */
export class WikiLinkMarkView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  constructor(mark: PMMark, _view: EditorView, _inline: boolean) {
    this.dom = createSpan("texto-wikilink");
    this.dom.setAttribute("data-wiki-path", String(mark.attrs.path ?? ""));

    this.contentDOM = createSpan("texto-wikilink-label");
    this.dom.appendChild(this.contentDOM);

    const icon = createSpan("texto-wikilink-icon");
    icon.setAttribute("aria-hidden", "true");
    // Outside contentDOM AND non-editable: the browser cannot place the
    // caret or a text-insertion point inside the icon.
    icon.setAttribute("contenteditable", "false");
    this.dom.appendChild(icon);
  }

  /** The wrapper's only dynamic part is the path attr — follow it. */
  update(mark: PMMark): boolean {
    if (mark.type.name !== "wikiLink") return false;
    this.dom.setAttribute("data-wiki-path", String(mark.attrs.path ?? ""));
    return true;
  }

  destroy(): void {
    this.dom.remove();
  }
}
