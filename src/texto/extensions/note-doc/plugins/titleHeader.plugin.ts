import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorState } from "prosemirror-state";

/**
 * Decorations for the title-page title node (spec 9.1) — a port of the
 * blog draft's TopicDoc plugin. While the title is empty it shows its
 * `data-placeholder`; while the caret is inside it and it has text it
 * gets the `focused` class, which the stylesheet turns into the blog's
 * field label with the vertical rule to the left of the field.
 *
 * Since title v3 the header is the title node only — the summary line
 * became properties (spec 9.1); property rows carry their own chrome in
 * noteProperty.plugin.
 *
 * The label's visibility also requires real editor focus; that part is
 * CSS-live (`.notepad-section-body:focus-within`), so no decoration work
 * is needed on focus changes.
 */
export function titleHeaderPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("titleHeader"),
    props: {
      decorations: (state: EditorState) => {
        const { doc, selection } = state;
        if (doc.content.childCount < 1) return null;

        const title = doc.content.child(0);
        if (title.type.name !== "noteTitle") return null;

        const decorations: Decoration[] = [];
        if (title.content.size === 0) {
          decorations.push(
            Decoration.node(0, title.nodeSize, {
              class: "empty",
              "data-placeholder": "Title",
            }),
          );
        } else if (selection.to <= title.nodeSize) {
          decorations.push(
            Decoration.node(0, title.nodeSize, {
              class: "focused",
              "data-label": "Title",
            }),
          );
        }

        return DecorationSet.create(doc, decorations);
      },
    },
  });
}
