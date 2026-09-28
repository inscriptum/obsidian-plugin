import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorState } from "prosemirror-state";

/**
 * Decorations for the title-page header (spec 9.1) — a port of the blog
 * draft's TopicDoc plugin. The header is the doc's first two children
 * (noteTitle, noteSummary). While a field is empty it shows its
 * `data-placeholder`; while the caret is inside the header and the field
 * has text it gets the `focused` class, which the stylesheet turns into
 * the blog's field label with the vertical rule to the left of the field.
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
        if (doc.content.childCount < 2) return null;

        const title = doc.content.child(0);
        const summary = doc.content.child(1);
        if (title.type.name !== "noteTitle" || summary.type.name !== "noteSummary") {
          return null;
        }

        const headerEnd = title.nodeSize + summary.nodeSize;
        const inHeader = selection.to <= headerEnd;

        const decorations: Decoration[] = [];
        if (title.content.size === 0) {
          decorations.push(
            Decoration.node(0, title.nodeSize, {
              class: "empty",
              "data-placeholder": "Title",
            }),
          );
        } else if (inHeader) {
          decorations.push(
            Decoration.node(0, title.nodeSize, {
              class: "focused",
              "data-label": "Title",
            }),
          );
        }

        if (summary.content.size === 0) {
          decorations.push(
            Decoration.node(
              title.nodeSize,
              title.nodeSize + summary.nodeSize,
              {
                class: "empty",
                "data-placeholder": "Summary of the text",
              },
            ),
          );
        } else if (inHeader) {
          decorations.push(
            Decoration.node(
              title.nodeSize,
              title.nodeSize + summary.nodeSize,
              {
                class: "focused",
                "data-label": "Summary",
              },
            ),
          );
        }

        return DecorationSet.create(doc, decorations);
      },
    },
  });
}
