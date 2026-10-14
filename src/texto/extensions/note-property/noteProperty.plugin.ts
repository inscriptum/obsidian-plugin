import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  acceptSuggestion,
  insertProperty,
  propertyInsertPos,
  propertyKeyDown,
  removeProperty,
  selectionProperty,
  stateProperty,
  suggestionItems,
} from "./notePropertyModel";

/**
 * UI affordances of the title-page property rows (spec 9.1):
 *  - placeholders ("Property name" / "Empty") on the focused row, the same
 *    data-placeholder mechanism the title header uses;
 *  - the focused row's remove (×) button, hanging into the left margin
 *    like the header field labels;
 *  - the "Add property" affordance between the last row and the content;
 *  - the name autocomplete: preset names filtered by the typed prefix,
 *    cycled with the arrow keys, accepted with Enter/Tab or a click,
 *    dismissed with Esc until the caret leaves the name field.
 *
 * Row keyboard behavior (Enter/Tab/Backspace) is routed through
 * notePropertyModel.propertyKeyDown; this plugin only adds the popup
 * handling on top and renders the chrome.
 */

interface NotePropertyPluginState {
  /** Selected index inside the open suggestion popup. */
  selected: number;
  /** Esc was pressed with suggestions open — hide them until the caret
   *  leaves the name field. */
  dismissed: boolean;
}

const key = new PluginKey<NotePropertyPluginState>("noteProperty");

export function notePropertyPlugin(): Plugin<NotePropertyPluginState> {
  return new Plugin<NotePropertyPluginState>({
    key,
    state: {
      init: () => ({ selected: 0, dismissed: false }),
      apply(tr, value) {
        const meta = tr.getMeta(key) as
          | Partial<NotePropertyPluginState>
          | undefined;
        let selected = value.selected;
        let dismissed = value.dismissed;
        if (meta != null) {
          if (meta.selected != null) selected = meta.selected;
          if (meta.dismissed != null) dismissed = meta.dismissed;
        } else if (tr.docChanged || tr.selectionSet) {
          selected = 0;
        }
        // The dismissal only holds while the caret stays in a name field.
        const loc = selectionProperty(tr.doc, tr.selection);
        if (loc == null || !loc.inName) dismissed = false;
        return { selected, dismissed };
      },
    },
    props: {
      decorations: (state: EditorState) =>
        DecorationSet.create(state.doc, buildDecorations(state)),
      handleKeyDown: (view: EditorView, event: KeyboardEvent) => {
        const pluginState = key.getState(view.state);
        const loc = stateProperty(view.state);
        const suggestions =
          loc != null && loc.inName && pluginState?.dismissed !== true
            ? suggestionItems(loc.nameText)
            : [];

        if (suggestions.length > 0) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const delta = event.key === "ArrowDown" ? 1 : -1;
            const count = suggestions.length;
            const selected = ((pluginState?.selected ?? 0) + delta + count) % count;
            view.dispatch(view.state.tr.setMeta(key, { selected }));
            return true;
          }
          if (event.key === "Escape") {
            view.dispatch(view.state.tr.setMeta(key, { dismissed: true }));
            return true;
          }
        }

        const pick =
          suggestions.length > 0
            ? () => {
                const index = Math.min(
                  pluginState?.selected ?? 0,
                  suggestions.length - 1,
                );
                return acceptSuggestion(
                  view.state,
                  (tr) => view.dispatch(tr),
                  suggestions[index],
                );
              }
            : null;

        // The model speaks PM-style key names: Shift+Tab arrives as
        // event.key === "Tab" with the modifier set.
        const keyName =
          event.key === "Tab" && event.shiftKey ? "Shift-Tab" : event.key;
        return propertyKeyDown(
          view.state,
          keyName,
          pick,
          (tr) => view.dispatch(tr),
        );
      },
    },
  });
}

function buildDecorations(state: EditorState): Decoration[] {
  const decorations: Decoration[] = [];
  const loc = stateProperty(state);

  state.doc.forEach((node, offset) => {
    if (node.type.name !== "noteProperty") return;
    // Top-level forEach offsets are absolute doc positions.
    const from = offset;
    const to = from + node.nodeSize;
    const focused = loc != null && loc.propFrom === from;

    if (!focused) return;

    decorations.push(Decoration.node(from, to, { class: "focused" }));

    const name = node.firstChild;
    if (name != null && name.type.name === "notePropertyName") {
      const nameNodeFrom = from + 1;
      if (name.content.size === 0) {
        decorations.push(
          Decoration.node(
            nameNodeFrom,
            nameNodeFrom + name.nodeSize,
            { class: "empty", "data-placeholder": "Property name" },
          ),
        );
      }
      if (loc.inName && suggestionsVisible(state)) {
        decorations.push(...suggestionDecorations(state));
      }
    }

    node.forEach((child, childOffset) => {
      if (child.type.name !== "notePropertyValue") return;
      if (child.content.size === 0) {
        const childFrom = from + 1 + childOffset;
        decorations.push(
          Decoration.node(
            childFrom,
            childFrom + child.nodeSize,
            { class: "empty", "data-placeholder": "Empty" },
          ),
        );
      }
    });

    decorations.push(
      Decoration.widget(
        from + 1,
        (view) => removeButton(view),
        { side: -1, key: `remove:${from}` },
      ),
    );
  });

  const addPos = propertyInsertPos(state.doc);
  if (addPos != null) {
    decorations.push(
      Decoration.widget(addPos, (view) => addButton(view), {
        side: 1,
        key: "add-property",
      }),
    );
  }

  return decorations;
}

/** Suggestions render only while the caret is in a name field, not
 *  dismissed, with at least one matching preset; decorations and key
 *  handling consult the same predicate so they can never disagree. */
function suggestionsVisible(state: EditorState): boolean {
  const pluginState = key.getState(state);
  const loc = stateProperty(state);
  if (loc == null || !loc.inName) return false;
  if (pluginState?.dismissed === true) return false;
  return suggestionItems(loc.nameText).length > 0;
}

function suggestionDecorations(state: EditorState): Decoration[] {
  const loc = stateProperty(state);
  if (loc == null || !loc.inName) return [];
  const items = suggestionItems(loc.nameText);
  if (items.length === 0) return [];
  const selected = Math.min(key.getState(state)?.selected ?? 0, items.length - 1);
  return [
    Decoration.widget(loc.nameFrom, (view) => suggestionList(view, items, selected), {
      key: `suggestions:${items.join("|")}:${selected}`,
      side: 1,
    }),
  ];
}

function removeButton(view: EditorView): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-property-remove";
  button.setAttribute("aria-label", "Remove property");
  button.textContent = "×";
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const loc = stateProperty(view.state);
    if (loc == null) return;
    removeProperty(view.state, (tr) => view.dispatch(tr), loc);
  });
  return button;
}

function addButton(view: EditorView): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-property-add";
  button.textContent = "Add property";
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    insertProperty(view.state, (tr) => view.dispatch(tr));
  });
  return button;
}

function suggestionList(
  view: EditorView,
  items: string[],
  selected: number,
): HTMLElement {
  const list = document.createElement("div");
  list.className = "note-property-suggestions";
  items.forEach((name, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className =
      index === selected
        ? "note-property-suggestion is-selected"
        : "note-property-suggestion";
    item.textContent = name;
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      acceptSuggestion(view.state, (tr) => view.dispatch(tr), name);
    });
    list.appendChild(item);
  });
  return list;
}
