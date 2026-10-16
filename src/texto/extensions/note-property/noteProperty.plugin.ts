import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { TextSelection } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model";
import {
  acceptSuggestion,
  coverBoundaryKeyDown,
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
 *  - the row's remove (trash) button at the row's right end, revealed on
 *    row hover;
 *  - the "Add property" affordance: one quiet line after the last row;
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
      //    committed); the draft stays when the caret leaves (no layout
      //    shift) and is stripped at the storage boundary — a row with no
      //    tags serializes zero values;
      //  - a Text row always keeps exactly one value.
      // Processed back-to-front so earlier offsets stay valid; idempotent
      // (a maintenance pass finds nothing to change and terminates).
      appendTransaction: (_transactions, _oldState, newState) => {
        const { selection } = newState;
        const tr = newState.tr;
        let changed = 0;
        const caretLoc = stateProperty(newState);
        const rows: Array<{ from: number; to: number; node: ProseMirrorNode }> = [];
        const oldRows: ProseMirrorNode[] = [];
        newState.doc.forEach((node, offset) => {
          if (node.type.name === "noteProperty") {
            rows.push({ from: offset, to: offset + node.nodeSize, node });
          }
        });
        // The previous document's property rows, in order — the revert of
        // a duplicated preset name maps rows[i] onto this[i] (the doc's
        // child(i) would read the leading title and shift every index).
        _oldState.doc.forEach((node) => {
          if (node.type.name === "noteProperty") oldRows.push(node);
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
          // Rows are processed back-to-front, so from/to/values (measured
          // on newState.doc) stay valid: already-processed rows live at
          // deeper offsets.

          // The caret never rests inside a locked (preset-named) name
          // field — nothing paints there and nothing can be typed. It
          // moves to the row's first value; a row without any value (a
          // List row fresh from storage, never focused) has no caret place
          // after the name, so its draft value is created in the same
          // transaction.
          let draftAddedHere = false;
          if (
            focused &&
            selection.$head.node(1) === node &&
            selection.$head.node(2)?.type.name === "notePropertyName" &&
            isPresetName(node.firstChild?.textContent ?? "")
          ) {
            const nameSize = node.firstChild?.nodeSize;
            if (nameSize != null) {
              if (values.length === 0) {
                tr.insert(
                  to - 1,
                  newState.schema.nodes.notePropertyValue.create(),
                );
                draftAddedHere = true;
                changed += 1;
              }
              tr.setSelection(
                TextSelection.create(tr.doc, from + 1 + nameSize + 1),
              );
              changed += 1;
            }
          }

          // No formatting in property fields: any mark that reaches the
          // row (bubble menu, keyboard shortcut, formatted paste) is
          // stripped — the fields stay plain text.
          let rowHasMarks = false;
          newState.doc.nodesBetween(from, to, (child) => {
            if (child.marks.length > 0) rowHasMarks = true;
            return true;
          });
          if (rowHasMarks) {
            tr.removeMark(from + 1, to - 1);
            changed += 1;
          }
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
              // The revert changes the name's length — the rest of this
              // row's maintenance would run on shifted positions, so it is
              // left to the next pass (appendTransaction re-runs until
              // stable).
              const oldRow = oldRows[i];
              const oldName = oldRow?.firstChild?.textContent ?? "";
              const nameFrom = from + 1 + 1; // name content start
              const nameTo = nameFrom + (node.firstChild?.content.size ?? 0);
              tr.replaceWith(
                nameFrom,
                nameTo,
                oldName.length > 0 ? newState.schema.text(oldName) : Fragment.empty,
              );
              changed += 1;
              continue;
            }
          }

          if (isList) {
            // Tag validity: a value becomes a tag only when it is filled
            // and not a duplicate of an earlier sibling. Empties (erased
            // chips) and duplicates (draft words abandoned mid-row) are
            // pruned — except the value under the caret (the word being
            // typed) and the trailing empty draft.
            let pruned = false;
            for (let vi = values.length - 1; vi >= 0; vi -= 1) {
              const v = values[vi];
              if (vi === values.length - 1 && v.text === "") continue;
              if (
                caretLoc != null &&
                caretLoc.propFrom === from &&
                !caretLoc.inName &&
                caretLoc.valueIndex === vi
              ) {
                continue;
              }
              const text = v.text.trim().toLowerCase();
              const invalid =
                text.length === 0 ||
                values.some(
                  (o, oi) => oi < vi && o.text.trim().toLowerCase() === text,
                );
              if (invalid) {
                tr.delete(v.from - 1, v.from - 1 + v.size);
                pruned = true;
                changed += 1;
              }
            }
            if (pruned) continue;
            const last = values[values.length - 1];
            if (focused && !draftAddedHere && !(last != null && last.text === "")) {
              // The row holding the caret always keeps one trailing empty
              // value as its draft input (a chip is only created when a
              // word is committed with Enter).
              tr.insert(to - 1, newState.schema.nodes.notePropertyValue.create());
              changed += 1;
            }
          } else if (values.length === 0 && !draftAddedHere) {
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
            // The draft is empty — browser hit-testing resolves a click in
            // it to the neighboring chip's text, so the caret goes to the
            // clicked element's own content end directly.
            const placed = placeCaretInValueElement(view, draft);
            if (placed != null) dragAnchorByView.set(view, placed);
            view.focus();
            return true;
          }

          // Any other click in a locked-name row (the name itself, the
          // empty side of a zero-value List row) places the caret in the
          // row's draft input.
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
        // The autocomplete popup owns the navigation keys while it is open.
        if (suggestions.length > 0) {
          const selected = Math.min(pluginState?.selected ?? 0, suggestions.length - 1);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const step = event.key === "ArrowDown" ? 1 : -1;
            const next = (selected + step + suggestions.length) % suggestions.length;
            view.dispatch(view.state.tr.setMeta(key, { selected: next }));
            return true;
          }
          if (event.key === "Escape") {
            view.dispatch(view.state.tr.setMeta(key, { dismissed: true }));
            return true;
          }
        }
        // Values are single-line: with a selection inside one property row,
        // Enter/Shift-Enter first deletes the selection — PM's splitBlock
        // would otherwise duplicate the field.
        if (
          (keyName === "Enter" || keyName === "Shift-Enter") &&
          !view.state.selection.empty
        ) {
          const { $from, $to } = view.state.selection;
          if (
            $from.depth >= 2 &&
            $from.node(1)?.type.name === "noteProperty" &&
            $to.node(1) === $from.node(1)
          ) {
            view.dispatch(view.state.tr.delete($from.pos, $to.pos));
            // The state is updated synchronously; the collapsed caret now
            // takes the row's normal Enter semantics below.
          }
        }
        // The cover (title + property rows) is sealed: boundary keys are
        // handled before the row-internal routing.
        if (coverBoundaryKeyDown(view.state, keyName, (tr) => view.dispatch(tr))) {
          return true;
        }
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
    // One continuous vertical rule across the title and every property:
    // a widget measures the zone's DOM rects and draws a single absolute
    // line in the left margin (the old Title/Summary field rule, now
    // covering the whole cover block as one rigid unit).
    decorations.push(
      Decoration.widget(0, (view) => zoneRuleWidget(view, zoneEnd), {
        side: -1,
        key: `zonerule:${zoneEnd}`,
      }),
    );
  }

  state.doc.forEach((node, offset) => {
    if (node.type.name !== "noteProperty") return;
    // Top-level forEach offsets are absolute doc positions.
    const from = offset;
    const to = from + node.nodeSize;
    const focused = loc != null && loc.propFrom === from;

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
      if (focused) {
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
    }

    // The row's trash renders on every List row (revealed by CSS on row
    // hover — no caret needed). The bounds are resolved at click time.
    decorations.push(
      Decoration.widget(
        from + 1,
        (view) => removeButton(view),
        { side: -1, key: `remove:${from}` },
      ),
    );

    // Chips and the draft input. The trailing empty value of a List row is
    // ALWAYS the draft slot (focused or not): it renders invisible and
    // keeps its place in the layout, so nothing shifts when the caret
    // enters or leaves the row. Every value with text is a chip with its
    // own ×, always visible.
    if (isList) {
      values.forEach((v, index) => {
        const nodeFrom = v.from - 1;
        // The trailing empty value is always the draft slot; it renders
        // invisible and keeps its place in the layout, so nothing shifts
        // when the caret enters or leaves the row. Every value with text
        // is a chip with its own ×, always visible.
        const isDraft = index === values.length - 1 && v.text === "";
        if (isDraft) {
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

    if (!focused) return;

    decorations.push(Decoration.node(from, to, { class: "focused" }));

  });

  // The "+ Add property" affordance: one quiet line after the last row.
  // The line is always reserved (its height never changes), the text is
  // visible only while the caret is inside the cover zone — hiding it
  // cannot shift the content below.
  const addPos = propertyInsertPos(state.doc);
  if (addPos != null) {
    decorations.push(
      Decoration.widget(addPos, (view) => addButton(view, zoneFocused), {
        side: 1,
        key: `add-property:${zoneFocused ? "on" : "off"}`,
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
  button.appendChild(spriteIcon("trash"));
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    // The row's bounds are resolved at click time: the widget can outlive
    // the row's geometry (edits above shift every position, edits inside
    // change its size), and a stale range would delete into a neighbor.
    const row = button.closest(".note-property");
    if (!(row instanceof HTMLElement)) return;
    let propFrom: number | null = null;
    try {
      propFrom = view.posAtDOM(row, 0) - 1;
    } catch {
      return;
    }
    if (propFrom == null || propFrom < 0) return;
    const node = view.state.doc.nodeAt(propFrom);
    if (node == null || node.type.name !== "noteProperty") return;
    removeProperty(
      view.state,
      (tr) => view.dispatch(tr),
      {
        propFrom,
        propTo: propFrom + node.nodeSize,
        inName: false,
        nameFrom: 0,
        nameTo: 0,
        nameText: "",
        valueIndex: -1,
        values: [],
        isEmpty: true,
      },
    );
  });
  return button;
}

function addButton(view: EditorView, visible: boolean): HTMLElement {
  // A quiet text button on its own line after the last property row. The
  // line belongs to the layout permanently; `visible` (the zone's focus)
  // only toggles the text — no reflow either way.
  const line = document.createElement("div");
  line.className = visible
    ? "note-property-add is-active"
    : "note-property-add";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-property-add__btn";
  button.textContent = "+ Add property";
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    insertProperty(view.state, (tr) => view.dispatch(tr));
    view.focus();
  });
  line.appendChild(button);
  return line;
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

/** Caret at the end of a specific value element's content (its first
 *  content position when the value is empty). Null when the element does
 *  not map into a property value. */
function placeCaretInValueElement(view: EditorView, el: HTMLElement): number | null {
  try {
    const at = view.posAtDOM(el, el.childNodes.length);
    const $at = view.state.doc.resolve(at);
    if ($at.depth < 2 || $at.parent.type.name !== "notePropertyValue") return null;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, at)).scrollIntoView(),
    );
    return at;
  } catch {
    return null;
  }
}

/** Place the caret for a click inside a locked-name row: exactly at the
 *  pointed value position when hit-testing agrees, otherwise at the end of
 *  the row's last value (the draft slot — where the next word goes). A
 *  zero-value row gains its draft value first. Returns the placed position
 *  (null when the caret could not be placed). */
function placeCaretFromPoint(
  view: EditorView,
  x: number,
  y: number,
  row: HTMLElement,
): number | null {
  // A click in the empty row space right of the last value goes to the
  // row's end (the draft input), not to the nearest text the browser's
  // hit-testing would pick (the first chip).
  const valueEls = row.querySelectorAll(".note-property-value");
  const lastEl = valueEls[valueEls.length - 1];
  const pastLast = lastEl == null || x > lastEl.getBoundingClientRect().right;
  const hit = pastLast ? null : valuePosFromPoint(view, x, y);
  if (hit != null) {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.pos)).scrollIntoView(),
    );
    return hit.pos;
  }
  const rowPos = view.posAtDOM(row, 0);
  const propFrom = rowPos - 1;
  let prop = view.state.doc.nodeAt(propFrom);
  if (prop == null || prop.type.name !== "noteProperty") return null;
  // The click in the row's empty space targets the draft input: a List
  // row gets one (fresh from storage it has none; a row whose last chip
  // is committed gets a fresh draft after it). Text rows keep their
  // single value — the caret goes after its text.
  if (
    (prop.attrs.type ?? "text") === "list" &&
    (prop.childCount < 2 || prop.lastChild?.textContent !== "")
  ) {
    view.dispatch(
      view.state.tr
        .insert(
          propFrom + prop.nodeSize - 1,
          view.state.schema.nodes.notePropertyValue.create(),
        )
        .scrollIntoView(),
    );
    prop = view.state.doc.nodeAt(propFrom);
    if (prop == null) return null;
  }
  // Inside the last value's content — a text selection must point INTO
  // the field: its first content position, never the node boundary.
  const last = prop.lastChild;
  if (last == null) return null;
  let lastStart = propFrom + 1;
  prop.forEach((child) => {
    if (child !== last) lastStart += child.nodeSize;
  });
  const target = lastStart + 1 + last.content.size;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, target)).scrollIntoView(),
  );
  return target;
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

/** The continuous left margin rule of the cover zone: one absolute line
 *  spanning the title's top through the add-property line, measured from
 *  the live DOM. The measurement runs in the next animation frame: at
 *  widget-creation time the DOM may still carry the pre-transaction
 *  layout (a just-deleted row would leave the line too long, drawn over
 *  the body text). */
function zoneRuleWidget(view: import("prosemirror-view").EditorView, zoneEnd: number): HTMLElement {
  const anchor = document.createElement("span");
  anchor.className = "note-property-zone-rule-anchor";
  const measure = () => {
    if (!anchor.isConnected) return; // the widget was replaced meanwhile
    try {
      const pmRect = view.dom.getBoundingClientRect();
      const titleEl = view.dom.querySelector(":scope > h1");
      const rows = view.dom.querySelectorAll(":scope > .note-property");
      const lastRow = rows[rows.length - 1];
      // The rule reaches past the "+" line, so the whole cover (title,
      // rows, the add affordance) reads as one block.
      const addEl = view.dom.querySelector(":scope > .note-property-add");
      if (titleEl != null && lastRow != null) {
        const top = titleEl.getBoundingClientRect();
        const bottom = (addEl ?? lastRow).getBoundingClientRect();
        const line = document.createElement("div");
        line.className = "note-property-zone-rule";
        line.style.left = `${Math.round(top.left - pmRect.left - 21)}px`;
        line.style.top = `${Math.round(top.top - pmRect.top - 8)}px`;
        line.style.height = `${Math.round(bottom.bottom - top.top + 14)}px`;
        anchor.replaceChildren(line);
      }
    } catch {
      // measurement is best-effort: an empty anchor renders nothing
    }
  };
  requestAnimationFrame(measure);
  void zoneEnd;
  return anchor;
}
