import { Editor } from "../../texto/core";
import { normalizeLinkUrl } from "./linkUrl";

/** Apply a URL to the current selection / caret, shared by the desktop
 *  toolbar link layer and the mobile menu dock link panel:
 *  - with a text selection — set the link mark on it;
 *  - with a bare caret on an existing link — rewrite that link's href,
 *    keeping its text;
 *  - with a bare caret elsewhere — insert the URL as the link's own text.
 *  Behavior mirrors the desktop toolbar link layer verbatim (the dock
 *  replaces it on mobile — rule-cr-parity: one source of the rules). */
export function applyLinkUrl(editor: Editor, rawUrl: string): void {
  const url = normalizeLinkUrl(rawUrl);
  const { selection } = editor.state;
  if (!url) return;
  if (selection.empty && editor.isActive("link")) {
    // Bare caret on a link: rewrite that link's href, keep its text.
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setMark("link", { href: url })
      .setMeta("preventAutolink", true)
      .run();
  } else if (selection.empty) {
    // No selection: the URL becomes the link's own text.
    editor
      .chain()
      .focus()
      .insertContent({
        type: "text",
        text: url,
        marks: [{ type: "link", attrs: { href: url } }],
      })
      .setMeta("preventAutolink", true)
      .run();
  } else {
    editor
      .chain()
      .focus()
      .setMark("link", { href: url })
      .setMeta("preventAutolink", true)
      .run();
  }
}

/** Remove the link mark — extends across the whole link when the caret sits
 *  on one (the toolbar's trash button semantics). */
export function removeLinkMark(editor: Editor): void {
  editor
    .chain()
    .focus()
    .unsetMark("link", { extendEmptyMarkRange: true })
    .run();
}
