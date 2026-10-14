import type { EditorState, Selection, Transaction } from "prosemirror-state";
import { TextSelection } from "prosemirror-state";
import { Fragment, type Node as PMNode } from "prosemirror-model";

/**
 * Behavior model of the title-page property rows (spec 9.1): pure
 * ProseMirror state → transaction helpers, no editor instance, so the
 * keyboard/UI rules are testable without a live view. The plugin
 * (noteProperty.plugin) routes key events and DOM clicks here; the
 * storage-level JSON shape lives in src/storage/um/umSchemas.ts — this
 * module is editor-side and must not import the storage layer.
 */

/** Preset property rows (9.1): name → value type, following Obsidian —
 *  `tags` holds a list of separate tag chips, the rest hold one text line.
 *  A preset NAME is fixed: a row named with a preset cannot be renamed
 *  (delete the row and add another); any other name stays freely typeable.
 *  `description` mirrors the migrated legacy summary (the storage layer's
 *  DESCRIPTION_PROPERTY_NAME); the website export reads the meta
 *  description from a property with this name. */
export const PROPERTY_PRESETS: ReadonlyArray<{
  name: string;
  type: "text" | "list";
}> = [
  { name: "description", type: "text" },
  { name: "tags", type: "list" },
  { name: "status", type: "text" },
  { name: "version", type: "text" },
];

export const PROPERTY_NAME_PRESETS: readonly string[] = PROPERTY_PRESETS.map(
  (p) => p.name,
);

/** True when the (trimmed, case-insensitive) name is one of the presets —
 *  such a row's name field is locked. */
export function isPresetName(nameText: string): boolean {
  const name = nameText.trim().toLowerCase();
  return PROPERTY_NAME_PRESETS.includes(name);
}

/** The preset's value type, or null for a non-preset name. */
export function presetType(nameText: string): "text" | "list" | null {
  const name = nameText.trim().toLowerCase();
  return PROPERTY_PRESETS.find((p) => p.name === name)?.type ?? null;
}

/** Preset suggestions matching what is typed (case-insensitive prefix);
 *  an exact match is not suggested again. */
export function suggestionItems(nameText: string): string[] {
  const typed = nameText.trim().toLowerCase();
  return PROPERTY_NAME_PRESETS.filter(
    (preset) => preset !== typed && preset.startsWith(typed),
  );
}

/** Where the caret sits inside a property row. All ranges are content
 *  ranges (inside the field nodes), not node boundaries. */
export interface PropertySelection {
  propFrom: number;
  propTo: number;
  /** True when the caret is in the name field, false when in a value. */
  inName: boolean;
  /** Content range inside the name node. */
  nameFrom: number;
  nameTo: number;
  nameText: string;
  /** 0-based index of the value holding the caret, −1 in the name. */
  valueIndex: number;
  values: Array<{ from: number; to: number; size: number; text: string }>;
  /** Name empty and every value empty. */
  isEmpty: boolean;
}

interface ValueInfo {
  from: number;
  to: number;
  size: number;
  text: string;
}

function propertyValues(prop: PMNode, propFrom: number): ValueInfo[] {
  const values: ValueInfo[] = [];
  let nodeStart = propFrom + 1;
  prop.forEach((child, offset) => {
    if (offset > 0) {
      const from = nodeStart + 1;
      values.push({
        from,
        to: from + child.content.size,
        size: child.nodeSize,
        text: child.textContent,
      });
    }
    nodeStart += child.nodeSize;
  });
  return values;
}

/** The property row under the caret, or null when the (empty) selection
 *  is not inside a noteProperty name/value field. */
export function selectionProperty(
  doc: PMNode,
  selection: Selection,
): PropertySelection | null {
  const { $head, empty } = selection;
  if (!empty || $head.depth < 2) return null;
  const prop = $head.node(1);
  if (prop.type.name !== "noteProperty") return null;
  const field = $head.node(2);
  const inName = field.type.name === "notePropertyName";
  if (!inName && field.type.name !== "notePropertyValue") return null;

  const propFrom = $head.before(1);
  const propTo = $head.after(1);
  const name = prop.firstChild;
  if (name == null || name.type.name !== "notePropertyName") return null;

  const nameFrom = propFrom + 2;
  const nameTo = nameFrom + name.content.size;
  const values = propertyValues(prop, propFrom);

  const valueIndex = inName
    ? -1
    : values.findIndex((v) => $head.pos >= v.from && $head.pos <= v.to);
  if (!inName && valueIndex === -1) return null;

  return {
    propFrom,
    propTo,
    inName,
    nameFrom,
    nameTo,
    nameText: name.textContent,
    valueIndex,
    values,
    isEmpty: name.textContent.length === 0 && values.every((v) => !v.text),
  };
}

/** The property row for an editor state (convenience over doc+selection). */
export function stateProperty(state: EditorState): PropertySelection | null {
  return selectionProperty(state.doc, state.selection);
}

/** Insert position for a new property row: right after the last one, or
 *  directly after the title node when the page has none (properties stay
 *  contiguous between the title and the content blocks, spec 9.1). Null
 *  when the document shape gives no anchor (no leading title node). */
export function propertyInsertPos(doc: PMNode): number | null {
  let insertPos: number | null = null;
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (i === 0 && child.type.name !== "noteTitle") return null;
    if (child.type.name === "noteProperty") {
      insertPos = pos + child.nodeSize;
    } else if (insertPos == null && i > 0) {
      insertPos = pos;
    }
    pos += child.nodeSize;
  }
  return insertPos;
}

function emptyProperty(schema: EditorState["schema"]): PMNode {
  return schema.nodes.noteProperty.create({ type: "text" }, [
    schema.nodes.notePropertyName.create(),
    schema.nodes.notePropertyValue.create(),
  ]);
}

/** Add a fresh empty property row and put the caret in its name field. */
export function insertProperty(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const pos = propertyInsertPos(state.doc);
  if (pos == null) return false;
  if (dispatch) {
    const prop = emptyProperty(state.schema);
    const tr = state.tr;
    const after = state.doc.nodeAt(pos);
    if (after != null) {
      // Splice the new row directly before the block that follows the
      // boundary — a bare tr.insert(pos, …) lets the fitter drift past it.
      tr.replaceWith(pos, pos + after.nodeSize, [prop, after]);
    } else {
      tr.insert(pos, prop);
    }
    // Caret inside the new row's name field: pos is the row's node start,
    // its name content starts at pos + 2.
    tr.setSelection(TextSelection.create(tr.doc, pos + 2));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Delete the whole row; the caret lands where the row was (end of the
 *  previous block). */
export function removeProperty(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  loc: PropertySelection,
): boolean {
  if (dispatch) {
    const tr = state.tr.delete(loc.propFrom, loc.propTo);
    tr.setSelection(TextSelection.near(tr.doc.resolve(loc.propFrom), -1));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Caret into the first value's content (Enter/Tab in the name). */
export function focusValue(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  loc: PropertySelection,
): boolean {
  const first = loc.values[0];
  if (first == null) return false;
  if (dispatch) {
    const tr = state.tr;
    tr.setSelection(TextSelection.create(tr.doc, first.from));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Caret to the end of the name (Shift-Tab from the first value). */
export function focusName(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  loc: PropertySelection,
): boolean {
  if (dispatch) {
    const tr = state.tr;
    tr.setSelection(TextSelection.create(tr.doc, loc.nameTo));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** True when the value under `index` duplicates another value of the same
 *  row (trimmed, case-insensitive) — Obsidian tags: tags are unique. */
export function isDuplicateTag(loc: PropertySelection, index: number): boolean {
  const value = loc.values[index];
  if (value == null) return false;
  const text = value.text.trim().toLowerCase();
  if (text.length === 0) return false;
  return loc.values.some(
    (other, i) => i !== index && other.text.trim().toLowerCase() === text,
  );
}

/** Enter in a List value: a word becomes a tag chip and a fresh draft
 *  opens after it; Enter on an empty draft (no word typed) or on a
 *  duplicate does nothing. */
export function appendValue(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  loc: PropertySelection,
): boolean {
  const current = loc.values[loc.valueIndex];
  if (current == null) return false;
  // An empty draft carries no word: Enter keeps the row as it is. A word
  // that duplicates a sibling tag is rejected too (tags are unique).
  if (current.text.trim().length === 0) return true;
  if (isDuplicateTag(loc, loc.valueIndex)) return true;
  if (dispatch) {
    const at = current.from - 1 + current.size;
    const tr = state.tr.insert(at, state.schema.nodes.notePropertyValue.create());
    tr.setSelection(TextSelection.create(tr.doc, at + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Remove one chip of a List property (the chip's own × button): the
 *  value node goes away; removing the last chip clears it into the row's
 *  draft entry (a row always keeps at least one value node while it is
 *  being edited; the plugin prunes empty drafts when the focus leaves). */
export function removeChipAt(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  propFrom: number,
  valueIndex: number,
): boolean {
  const prop = state.doc.nodeAt(propFrom);
  if (prop == null || prop.type.name !== "noteProperty") return false;
  const values: Array<{ from: number; size: number; text: string }> = [];
  let nodeStart = propFrom + 1;
  prop.forEach((child, offset) => {
    if (offset > 0) {
      values.push({ from: nodeStart + 1, size: child.nodeSize, text: child.textContent });
    }
    nodeStart += child.nodeSize;
  });
  const target = values[valueIndex];
  if (target == null) return false;

  if (dispatch) {
    const tr = state.tr;
    if (values.length > 1) {
      tr.delete(target.from - 1, target.from - 1 + target.size);
      const next = values[valueIndex + 1];
      const prev = values[valueIndex - 1];
      if (next != null) {
        tr.setSelection(TextSelection.create(tr.doc, target.from));
      } else if (prev != null) {
        tr.setSelection(TextSelection.create(tr.doc, prev.from - 1 + prev.size - 1));
      }
    } else {
      // The only chip: clear it — it becomes the row's draft entry.
      tr.replaceWith(target.from, target.from + target.text.length, Fragment.empty);
      tr.setSelection(TextSelection.create(tr.doc, target.from));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Enter in a Text value: the content is fixed — the caret moves on, to
 *  the next property's name field when one follows, otherwise to the next
 *  content block below (the trailing paragraph the profile guarantees). */
export function exitTextValue(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  loc: PropertySelection,
): boolean {
  if (dispatch) {
    const doc = state.doc;
    let target: number | null = null;
    let pos = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      if (pos === loc.propFrom) {
        const next = doc.child(i + 1);
        if (next != null) {
          const nextPos = pos + child.nodeSize;
          target =
            next.type.name === "noteProperty" ? nextPos + 2 : nextPos + 1;
        }
        break;
      }
      pos += child.nodeSize;
    }
    if (target != null) {
      const tr = state.tr;
      tr.setSelection(TextSelection.near(tr.doc.resolve(target), 1));
      dispatch(tr.scrollIntoView());
    }
  }
  return true;
}

/** Accept an autocomplete suggestion: rewrite the name field with the
 *  chosen name and move the caret into the first value. */
export function acceptSuggestion(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  value: string,
): boolean {
  const loc = stateProperty(state);
  if (loc == null || !loc.inName) return false;
  if (dispatch) {
    const tr = state.tr.replaceWith(
      loc.nameFrom,
      loc.nameTo,
      value.length > 0 ? state.schema.text(value) : Fragment.empty,
    );
    // The name now equals a preset — adopt its value type (attributes move
    // no positions, so the geometry below stays valid).
    const type = presetType(value);
    if (type != null) tr.setNodeAttribute(loc.propFrom, "type", type);
    // The name node may have changed size: resolve the first value in the
    // new document.
    const nameSize = tr.doc.nodeAt(loc.propFrom)?.firstChild?.nodeSize ?? 2;
    tr.setSelection(
      TextSelection.create(tr.doc, loc.propFrom + 1 + nameSize + 1),
    );
    dispatch(tr.scrollIntoView());
  }
  return true;
}

/** Keymap routing shared by the plugin's handleKeyDown. Returns true when
 *  the key was handled. `suggestionPick` (when set) intercepts Enter/Tab
 *  for the open autocomplete popup. */
export function propertyKeyDown(
  state: EditorState,
  key: string,
  suggestionPick: (() => boolean) | null,
  dispatch: (tr: Transaction) => void,
): boolean {
  const loc = stateProperty(state);
  if (loc == null) return false;

  if (loc.inName) {
    if ((key === "Enter" || key === "Tab") && suggestionPick?.()) return true;
    if (key === "Enter" || key === "Tab") {
      return focusValue(state, dispatch, loc);
    }
    if (key === "Shift-Enter") return true;
    if (key === "Backspace" && state.selection.$head.parentOffset === 0) {
      if (loc.isEmpty) return removeProperty(state, dispatch, loc);
      // At the name start: never join the name into the title or the row
      // above; elsewhere the default (character delete) applies.
      return true;
    }
    return false;
  }

  const atValueStart = state.selection.$head.parentOffset === 0;
  if (key === "Shift-Enter") {
    // Values are single-line: Enter-family keys never insert line breaks.
    return true;
  }
  if (key === "Enter") {
    // Obsidian semantics: a Text value is one fixed line — Enter moves on
    // (next property, or the content below); a List value grows by one
    // entry.
    const prop = state.doc.nodeAt(loc.propFrom);
    return prop?.attrs.type === "list"
      ? appendValue(state, dispatch, loc)
      : exitTextValue(state, dispatch, loc);
  }
  if (key === "Backspace" && atValueStart) {
    const current = loc.values[loc.valueIndex];
    if (current != null && current.text.length > 0) {
      // The first value never joins into the name; deeper values merge
      // into the previous one (a List joins its rows) — default applies.
      return loc.valueIndex === 0;
    }
    const prop = state.doc.nodeAt(loc.propFrom);
    if (prop?.attrs.type === "list") {
      // The empty value is the row's draft input — it stays while the row
      // holds the caret (the plugin removes it when the focus leaves).
      return true;
    }
    if (loc.isEmpty) return removeProperty(state, dispatch, loc);
    return true;
  }
  if (key === "Shift-Tab" && loc.valueIndex === 0) {
    return focusName(state, dispatch, loc);
  }
  return false;
}
