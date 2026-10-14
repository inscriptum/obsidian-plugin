import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
  acceptSuggestion,
  insertProperty,
  isPresetName,
  presetType,
  propertyInsertPos,
  propertyKeyDown,
  removeChipAt,
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
      // Row maintenance, Obsidian-tags style:
      //  - a row named with a preset adopts the preset's value type;
      //  - a List row holding the caret keeps one trailing empty value as
      //    its draft input (a chip is only created when a word is
      //    committed); when the caret leaves, the empty draft is pruned —
      //    a row with no tags at all serializes zero values;
      //  - a Text row always keeps exactly one value.
      // Processed back-to-front so earlier offsets stay valid; idempotent
      // (a maintenance pass finds nothing to change and terminates).
      appendTransaction: (_transactions, _oldState, newState) => {
        const { selection } = newState;
        const tr = newState.tr;
        let changed = 0;
        const rows: Array<{ from: number; to: number; node: ProseMirrorNode }> = [];
        newState.doc.forEach((node, offset) => {
          if (node.type.name === "noteProperty") {
            rows.push({ from: offset, to: offset + node.nodeSize, node });
          }
        });
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const { from, to, node } = rows[i];
          const type = presetType(node.firstChild?.textContent ?? "");
          if (type != null && node.attrs.type !== type) {
            tr.setNodeAttribute(from, "type", type);
            changed += 1;
          }
          const isList = (type ?? node.attrs.type) === "list";
          const values: Array<{ from: number; to: number; size: number; text: string }> = [];
          let pos = from + 1;
          node.forEach((child, childOffset) => {
            if (childOffset > 0) {
              values.push({
                from: pos + 1,
                to: pos + 1 + child.content.size,
                size: child.nodeSize,
                text: child.textContent,
              });
            }
            pos += child.nodeSize;
          });
          const focused =
            selection.from >= from && selection.to <= to && selection.empty;

          if (isList) {
            const last = values[values.length - 1];
            if (focused && values.length === 0) {
              // Nothing to type into: the row gets its draft input. (A row
              // with committed tags needs none — Enter in the last chip
              // opens the next draft exactly when a word is committed.)
              tr.insert(
                to - 1,
                newState.schema.nodes.notePropertyValue.create(),
              );
              changed += 1;
            } else if (!focused && last != null && last.text === "") {
              tr.delete(last.from - 1, last.from - 1 + last.size);
              changed += 1;
            }
          } else if (values.length === 0) {
            tr.insert(to - 1, newState.schema.nodes.notePropertyValue.create());
            changed += 1;
          }
        }
        return changed > 0 ? tr : null;
      },
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
      handleDOMEvents: {
        // A locked (preset-named) name field takes no caret: a click on it
        // lands in the row's first value instead.
        mousedown: (view: EditorView, event: MouseEvent) => {
          const target = event.target as HTMLElement | null;
          const row = target?.closest?.(".note-property");
          if (!(row instanceof HTMLElement)) return false;
          const lockedName = target?.closest?.(".note-property-name.locked");
          const inValue = target?.closest?.(".note-property-value");
          if (!lockedName && !inValue) return false;
          if (lockedName == null && !row.querySelector(".note-property-name.locked")) {
            // Unlocked name + a value click: PM places the caret fine.
            return false;
          }
          // PM's coordinate resolution can park the caret inside the
          // non-editable name (invisible — nothing paints there). Route it
          // explicitly into the clicked value's content.
          const valueEl = inValue instanceof HTMLElement
            ? inValue
            : row.querySelector(".note-property-value");
          if (valueEl == null) return false;
          event.preventDefault();
          event.stopPropagation();
          const rowPos = view.posAtDOM(row, 0);
          // posAtDOM(el, 0) is the element's own start boundary.
          const propFrom = rowPos;
          const prop = view.state.doc.nodeAt(propFrom);
          const nameSize = prop?.firstChild?.nodeSize;
          if (nameSize == null) return true;
          const allValues = [...row.querySelectorAll(".note-property-value")];
          const index = allValues.indexOf(valueEl);
          let valueStart = propFrom + 1 + nameSize + 1;
          for (let i = 0; i < index; i += 1) {
            valueStart += (allValues[i].textContent?.length ?? 0) + 2;
          }
          const $value = view.state.doc.resolve(
            Math.min(valueStart, view.state.doc.content.size),
          );
          view.dispatch(
            view.state.tr.setSelection(TextSelection.near($value, 1)).scrollIntoView(),
          );
          view.focus();
          return true;
        },
      },
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

        // The model speaks PM-style key names: modified keys arrive as
        // event.key with the modifier set.
        const keyName =
          event.key === "Tab" && event.shiftKey
            ? "Shift-Tab"
            : event.key === "Enter" && event.shiftKey
              ? "Shift-Enter"
              : event.key;
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

  // The cover zone: the title plus all property rows. While the caret is
  // anywhere inside it, the vertical margin rule runs continuously through
  // the title and every row (the old Title/Summary field-rule look).
  const title = state.doc.child(0);
  let lastPropTo: number | null = null;
  let cursor = 0;
  for (let i = 0; i < state.doc.childCount; i++) {
    const child = state.doc.child(i);
    cursor += child.nodeSize;
    if (child.type.name === "noteProperty") lastPropTo = cursor;
  }
  const zoneEnd = lastPropTo ?? title.nodeSize;
  const zoneFocused =
    title.type.name === "noteTitle" && state.selection.to <= zoneEnd;
  if (zoneFocused && title.type.name === "noteTitle") {
    decorations.push(Decoration.node(0, title.nodeSize, { class: "rule" }));
  }

  state.doc.forEach((node, offset) => {
    if (node.type.name !== "noteProperty") return;
    // Top-level forEach offsets are absolute doc positions.
    const from = offset;
    const to = from + node.nodeSize;
    const focused = loc != null && loc.propFrom === from;
    if (zoneFocused) {
      decorations.push(Decoration.node(from, to, { class: "rule" }));
    }

    const isList = node.attrs.type === "list";
    const values: Array<{ from: number; to: number; size: number; text: string }> = [];
    let valuesPos = from + 1;
    node.forEach((child, childOffset) => {
      if (childOffset > 0) {
        values.push({
          from: valuesPos + 1,
          to: valuesPos + 1 + child.content.size,
          size: child.nodeSize,
          text: child.textContent,
        });
      }
      valuesPos += child.nodeSize;
    });
    // A List row with no committed tags shows the muted "Empty" mark in
    // the value column (as Obsidian does) — values only exist once a word
    // is committed.
    if (isList && values.every((v) => v.text === "")) {
      decorations.push(
        Decoration.node(from, to, { class: "empty-tags" }),
      );
    }

    const name = node.firstChild;
    if (name != null && name.type.name === "notePropertyName") {
      const nameNodeFrom = from + 1;
      const locked = isPresetName(name.textContent);
      if (locked) {
        // Preset names are fixed on every row (not only the focused one):
        // the field stops taking a caret, so the name is either the preset
        // or the user's own custom text.
        decorations.push(
          Decoration.node(nameNodeFrom, nameNodeFrom + name.nodeSize, {
            contenteditable: "false",
            class: "locked",
          }),
        );
      }
      // The type marker appears once the name exists — over an empty field
      // it would collide with the placeholder and the caret.
      if (name.content.size > 0) {
        decorations.push(
          Decoration.widget(
            nameNodeFrom + 1,
            () => typeIcon(presetType(name.textContent) ?? "text"),
            { side: -1, key: `icon:${from}:${name.textContent}` },
          ),
        );
      }
    }

    if (!focused) return;

    decorations.push(Decoration.node(from, to, { class: "focused" }));

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
      const childFrom = from + 1 + childOffset;
      if (!isList && child.content.size === 0) {
        decorations.push(
          Decoration.node(
            childFrom,
            childFrom + child.nodeSize,
            { class: "empty", "data-placeholder": "Empty" },
          ),
        );
      }
      if (isList) {
        const chipFrom = childFrom + 1;
        const isDraft = child.content.size === 0;
        if (isDraft) {
          // The trailing draft input: a bare caret slot while the row is
          // focused — not a chip (no pill, no ×).
          decorations.push(
            Decoration.node(childFrom, childFrom + child.nodeSize, {
              class: "draft",
            }),
          );
        } else {
          decorations.push(
            Decoration.widget(
              chipFrom + child.content.size,
              (view) => chipRemoveButton(view, from, valuesIndex(node, child)),
              { side: 1, key: `chipx:${chipFrom}` },
            ),
          );
        }
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

/** 0-based index of `child` among the value nodes of `prop`. */
function valuesIndex(prop: ProseMirrorNode, child: ProseMirrorNode): number {
  let index = -1;
  let i = 0;
  prop.forEach((c) => {
    if (c.type.name === "notePropertyValue") {
      if (c === child) index = i;
      i += 1;
    }
  });
  return index;
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

function spriteIcon(iconId: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#inscriptum-tlb-${iconId}`);
  svg.appendChild(use);
  return svg;
}

/** The value-type marker shown before the name, as in Obsidian. */
function typeIcon(type: "text" | "list"): HTMLElement {
  const span = document.createElement("span");
  span.className = "note-property-type-icon";
  span.setAttribute("aria-hidden", "true");
  span.appendChild(spriteIcon(type === "list" ? "propTag" : "propText"));
  return span;
}

/** The × inside one tag chip (List rows). */
function chipRemoveButton(
  view: EditorView,
  propFrom: number,
  valueIndex: number,
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-property-chip-x";
  button.setAttribute("aria-label", "Remove tag");
  button.appendChild(spriteIcon("x"));
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeChipAt(view.state, (tr) => view.dispatch(tr), propFrom, valueIndex);
    view.focus();
  });
  return button;
}

function removeButton(view: EditorView): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-property-remove";
  button.setAttribute("aria-label", "Remove property");
  button.appendChild(spriteIcon("x"));
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
  // A zero-height in-flow anchor whose button hangs into the left margin,
  // next to the row that would follow the last one.
  const anchor = document.createElement("div");
  anchor.className = "note-property-add";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-property-add__btn";
  button.setAttribute("aria-label", "Add property");
  button.setAttribute("title", "Add property");
  button.appendChild(spriteIcon("propPlus"));
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    insertProperty(view.state, (tr) => view.dispatch(tr));
  });
  anchor.appendChild(button);
  return anchor;
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
