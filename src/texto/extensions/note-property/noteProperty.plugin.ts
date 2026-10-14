import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model";
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

/** Manual drag-selection anchor for locked-name rows (mousedown position,
 *  per view; the mousemove handler extends it, mouseup clears it). */
const dragAnchorByView = new WeakMap<EditorView, number>();

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
        // The caret never rests inside a locked (preset-named) name field:
        // nothing paints there and nothing can be typed — a click that PM
        // resolves into it is moved to the row's first value.
        if (selection.empty && selection.$head.depth >= 2) {
          const row = selection.$head.node(1);
          const field = selection.$head.node(2);
          if (
            row?.type.name === "noteProperty" &&
            field?.type.name === "notePropertyName" &&
            isPresetName(row.firstChild?.textContent ?? "")
          ) {
            const propFrom = selection.$head.before(1);
            const nameSize = row.firstChild?.nodeSize;
            if (nameSize == null) return null;
            tr.setSelection(
              TextSelection.create(tr.doc, propFrom + 1 + nameSize + 1),
            );
            changed += 1;
          }
        }
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

          // A preset name is unique across the row's siblings: typing a
          // name that would duplicate another row's preset is reverted to
          // what the field carried before the keystroke.
          if (isPresetName(node.firstChild?.textContent ?? "")) {
            const name = (node.firstChild?.textContent ?? "").trim().toLowerCase();
            let duplicated = false;
            rows.forEach((other) => {
              if (other.from === from) return;
              if (
                isPresetName(other.node.firstChild?.textContent ?? "") &&
                (other.node.firstChild?.textContent ?? "").trim().toLowerCase() === name
              ) {
                duplicated = true;
              }
            });
            if (duplicated) {
              const oldRow = _oldState.doc.content.child(i);
              const oldName = oldRow.type.name === "noteProperty" ? oldRow.firstChild?.textContent ?? "" : "";
              const nameFrom = from + 1 + 1; // name content start
              const nameTo = nameFrom + (node.firstChild?.content.size ?? 0);
              tr.replaceWith(
                nameFrom,
                nameTo,
                oldName.length > 0 ? newState.schema.text(oldName) : Fragment.empty,
              );
              changed += 1;
            }
          }

          if (isList) {
            const last = values[values.length - 1];
            if (focused && values.length === 0) {
              // Nothing to type into: the row gets its draft input, and the
              // caret moves into it (the user came here to type a tag — the
              // "Empty" mark must not stay under the caret). (A row with
              // committed tags needs no speculative draft — Enter in the
              // last chip opens the next one exactly when a word is
              // committed.)
              const at = to - 1;
              tr.insert(at, newState.schema.nodes.notePropertyValue.create());
              tr.setSelection(
                TextSelection.create(tr.doc, at + 1),
              );
              changed += 1;
            } else if (!focused && last != null) {
              // The caret left the row: prune the un-committed tail — an
              // empty draft, and a word that duplicates a committed sibling
              // tag (its Enter was rejected; leaving must not commit it).
              const empty = last.text === "";
              const name = last.text.trim().toLowerCase();
              const duplicate =
                !empty &&
                name.length > 0 &&
                values.slice(0, -1).some((v) => v.text.trim().toLowerCase() === name);
              if (empty || duplicate) {
                tr.delete(last.from - 1, last.from - 1 + last.size);
                changed += 1;
              }
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
        // Rows with a locked (preset) name: PM's own hit-testing resolves
        // clicks unreliably (a chip sits in a flex row — the nearest
        // position lands in the non-editable name, where nothing paints).
        // Place the caret exactly where the user pointed via
        // caretRangeFromPoint, then drive the drag-selection manually
        // (mousemove extends from the mousedown anchor) and let a
        // double-click select the word under the pointer.
        mousedown: (view: EditorView, event: MouseEvent) => {
          const target = event.target as HTMLElement | null;
          const row = target?.closest?.(".note-property");
          if (!(row instanceof HTMLElement)) return false;
          if (!row.querySelector(".note-property-name.locked")) return false;

          const draft = target?.closest?.(".note-property-value.draft");
          if (draft instanceof HTMLElement) {
            event.preventDefault();
            event.stopPropagation();
            const placed = placeCaretFromPoint(view, event.clientX, event.clientY, row);
            if (placed != null) dragAnchorByView.set(view, placed);
            view.focus();
            return true;
          }

          if (
            !target?.closest?.(".note-property-value") &&
            !target?.closest?.(".note-property-name.locked")
          ) {
            return false;
          }
          event.preventDefault();
          event.stopPropagation();
          const placed = placeCaretFromPoint(view, event.clientX, event.clientY, row);
          if (placed == null) return true;
          if (event.shiftKey && !view.state.selection.empty) {
            // Shift-click: extend the current selection to the new point.
            const anchor = view.state.selection.anchor;
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(view.state.doc, anchor, placed),
              ).scrollIntoView(),
            );
            return true;
          }
          dragAnchorByView.set(view, placed);
          view.focus();
          return true;
        },
        mousemove: (view: EditorView, event: MouseEvent) => {
          if (event.buttons !== 1) {
            if (dragAnchorByView.has(view)) dragAnchorByView.delete(view);
            return false;
          }
          const anchor = dragAnchorByView.get(view);
          if (anchor == null) return false;
          const hit = valuePosFromPoint(view, event.clientX, event.clientY);
          if (hit == null || hit.pos === anchor) return false;
          const head = hit.pos;
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, anchor, head),
            ).scrollIntoView(),
          );
          return true;
        },
        mouseup: (view: EditorView) => {
          dragAnchorByView.delete(view);
          return false;
        },
        dblclick: (view: EditorView, event: MouseEvent) => {
          const target = event.target as HTMLElement | null;
          if (!target?.closest?.(".note-property-value")) return false;
          const row = target.closest(".note-property");
          if (!(row instanceof HTMLElement)) return false;
          if (!row.querySelector(".note-property-name.locked")) return false;
          event.preventDefault();
          event.stopPropagation();
          selectWordAtPoint(view, event.clientX, event.clientY);
          view.focus();
          return true;
        },
      },
      handleKeyDown: (view: EditorView, event: KeyboardEvent) => {
        const pluginState = key.getState(view.state);
        const loc = stateProperty(view.state);
        const suggestions =
          loc != null && loc.inName && pluginState?.dismissed !== true
            ? suggestionItems(loc.nameText, existingPresetNames(view.state, loc.propFrom))
            : [];
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
    const name = node.firstChild;
    if (name != null && name.type.name === "notePropertyName") {
      const nameNodeFrom = from + 1;
      const locked = isPresetName(name.textContent);
      if (locked) {
        // Preset names are fixed on every row: the field stops taking a
        // caret, so the name is either the preset or the user's own text.
        decorations.push(
          Decoration.node(nameNodeFrom, nameNodeFrom + name.nodeSize, {
            contenteditable: "false",
            class: "locked",
          }),
        );
      }
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

    // Unfocused List rows: no draft exists (pruned), so every value is a
    // chip with its × ready for a hover.
    if (!focused && isList) {
      values.forEach((v, index) => {
        decorations.push(
          Decoration.widget(
            v.to,
            (view) => chipRemoveButton(view, from, index),
            { side: 1, key: `chipx:${v.from}` },
          ),
        );
      });
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

    // Chips and the draft input. The LAST value of a focused List row is
    // the draft — a bare caret slot (no pill, no ×) no matter what is
    // typed into it; the pill appears when Enter commits the word and
    // opens the next draft. Every committed chip carries its own × (shown
    // on hover, always on the focused row).
    if (focused) {
      const lastIndex = values.length - 1;
      values.forEach((v, index) => {
        const nodeFrom = v.from - 1;
        if (!isList) {
          if (v.text === "") {
            decorations.push(
              Decoration.node(nodeFrom, nodeFrom + v.size, {
                class: "empty",
                "data-placeholder": "Empty",
              }),
            );
          }
          return;
        }
        if (index === lastIndex) {
          decorations.push(
            Decoration.node(nodeFrom, nodeFrom + v.size, { class: "draft" }),
          );
        } else {
          decorations.push(
            Decoration.widget(
              v.to,
              (view) => chipRemoveButton(view, from, index),
              { side: 1, key: `chipx:${v.from}` },
            ),
          );
        }
      });
    }

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
  return suggestionItems(loc.nameText, existingPresetNames(state, loc.propFrom)).length > 0;
}

/** Preset names carried by the OTHER property rows of this document. */
function existingPresetNames(state: EditorState, skipPropFrom: number): string[] {
  const names: string[] = [];
  state.doc.forEach((node, offset) => {
    if (offset === skipPropFrom) return;
    if (node.type.name === "noteProperty") {
      names.push(node.firstChild?.textContent ?? "");
    }
  });
  return names;
}

function suggestionDecorations(state: EditorState): Decoration[] {
  const loc = stateProperty(state);
  if (loc == null || !loc.inName) return [];
  const items = suggestionItems(loc.nameText, existingPresetNames(state, loc.propFrom));
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

/** Caret position for a pointer coordinate, as a document position inside
 *  a value field of `row` (null when the point resolves elsewhere). */
function valuePosFromPoint(
  view: EditorView,
  x: number,
  y: number,
): { pos: number; $pos: import("prosemirror-model").ResolvedPos } | null {
  const range = document.caretRangeFromPoint?.(x, y);
  if (range == null || !view.dom.contains(range.startContainer)) return null;
  let pos: number;
  try {
    pos = view.posAtDOM(range.startContainer, range.startOffset);
  } catch {
    return null;
  }
  const $pos = view.state.doc.resolve(pos);
  if ($pos.depth < 2) return null;
  if ($pos.node(2)?.type?.name !== "notePropertyValue") return null;
  return { pos, $pos };
}

/** Place the caret for a click inside a locked-name row: exactly at the
 *  pointed value position when hit-testing agrees, otherwise at the start
 *  of the row's first value. Returns the placed position (null when the
 *  caret could not be placed). */
function placeCaretFromPoint(
  view: EditorView,
  x: number,
  y: number,
  row: HTMLElement,
): number | null {
  const hit = valuePosFromPoint(view, x, y);
  if (hit != null) {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.pos)).scrollIntoView(),
    );
    return hit.pos;
  }
  // The point resolved outside any value (an empty slot, the name's
  // padding): fall back to the first value's content start.
  const rowPos = view.posAtDOM(row, 0);
  const propFrom = rowPos - 1;
  const nameSize = view.state.doc.nodeAt(propFrom)?.firstChild?.nodeSize;
  if (nameSize == null) return null;
  const fallback = Math.min(propFrom + 1 + nameSize + 1, view.state.doc.content.size);
  const $value = view.state.doc.resolve(fallback);
  view.dispatch(
    view.state.tr.setSelection(TextSelection.near($value, 1)).scrollIntoView(),
  );
  return fallback;
}

/** Select the word under the pointer (double-click in a tag chip). */
function selectWordAtPoint(view: EditorView, x: number, y: number): void {
  const hit = valuePosFromPoint(view, x, y);
  if (hit == null) return;
  const { $pos } = hit;
  const text = $pos.parent.textContent;
  const offset = Math.min($pos.parentOffset, text.length);
  const isWordChar = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
  let start = offset;
  let end = offset;
  while (start > 0 && isWordChar(text[start - 1] ?? "")) start -= 1;
  while (end < text.length && isWordChar(text[end] ?? "")) end += 1;
  if (start === end) return;
  const tr = view.state.tr.setSelection(
    TextSelection.create(view.state.doc, $pos.start() + start, $pos.start() + end),
  );
  view.dispatch(tr);
}
