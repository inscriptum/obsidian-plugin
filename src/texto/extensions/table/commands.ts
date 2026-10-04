import { Command } from "../../core/@types";
import { AnyConfig } from "../../core/@types/AnyConfig";
import {
  TextSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { TextoCellSelection } from "./helpers/TextoCellSelection";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  deleteColumn,
  deleteRow,
  deleteTable,
  fixTables,
  goToNextCell,
  isInTable,
  mergeCells,
  selectedRect,
  selectionCell,
  splitCell,
  TableMap,
  toggleHeader,
  toggleHeaderCell,
} from "prosemirror-tables";
import type { TableRect } from "prosemirror-tables";

import { findTableAnchor } from "./helpers";
import { createTable } from "./helpers/createTable";
import {
  BORDER_SIDES,
  penToSide,
  sideMatchesPen,
  type BorderPen,
  type BorderSideName,
  type CellBorders,
} from "./helpers/borders";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

function insertTable(
  this: AddCommandsThis,
  { rows = 3, cols = 3, withHeaderRow = true } = {},
): Command {
  return ({ tr, dispatch, editor, state }) => {
    const isReplaceLastElement =
      state.doc.content.size === state.selection.$to.pos + 1;
    if (isReplaceLastElement) {
      const paragraph = state.schema.nodes.paragraph.createAndFill();
      if (paragraph != null) {
        tr = tr.insert(state.selection.$to.pos + 1, paragraph);
      }
    }
    const node = createTable(editor.schema, rows, cols, withHeaderRow);

    if (dispatch) {
      tr.replaceSelectionWith(node);
      tr.scrollIntoView();
      tr.setSelection(
        TextSelection.near(tr.doc.resolve(state.selection.$from.pos + 1)),
      );
    }

    return true;
  };
}

function addColumnBeforeOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return addColumnBefore(state, dispatch);
  };
}

function addColumnAfterOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return addColumnAfter(state, dispatch);
  };
}

function deleteColumnOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return deleteColumn(state, dispatch);
  };
}

function addRowBeforeOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return addRowBefore(state, dispatch);
  };
}

function addRowAfterOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return addRowAfter(state, dispatch);
  };
}

function deleteRowOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return deleteRow(state, dispatch);
  };
}

function deleteTableOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return deleteTable(state, dispatch);
  };
}

function clearTable(this: AddCommandsThis): Command {
  return ({ tr, dispatch, state }) => {
    const anchor = findTableAnchor(state, -1, state.selection.$anchor);
    if (!anchor) {
      return false;
    }
    if (!dispatch) {
      return true;
    }

    const lastCellSize =
      anchor.node(-1).content.lastChild?.content.lastChild?.nodeSize ?? 0;
    const $head = state.doc.resolve(
      anchor.before(-1) + anchor.node(-1).nodeSize - lastCellSize - 2,
    );
    const $anchor = state.doc.resolve(anchor.start(-1) + 1);
    const selection = new TextoCellSelection($anchor, $head);

    tr.setSelection(selection).deleteSelection();

    return true;
  };
}

function mergeCellsOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return mergeCells(state, dispatch);
  };
}

function splitCellOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return splitCell(state, dispatch);
  };
}

function toggleHeaderColumn(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return toggleHeader("column")(state, dispatch);
  };
}

function toggleHeaderRow(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return toggleHeader("row")(state, dispatch);
  };
}

function toggleHeaderCellOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return toggleHeaderCell(state, dispatch);
  };
}

function mergeOrSplit(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    if (mergeCells(state, dispatch)) {
      return true;
    }

    return splitCell(state, dispatch);
  };
}

/**
 * @fork https://github.com/ProseMirror/prosemirror-tables/blob/67371611fa9964c20d7d8be741f88ea8b3c24900/src/commands.ts#L567
 */
function setCellsAttribute(
  this: AddCommandsThis,
  name: string,
  value: string,
): Command {
  return ({ state, dispatch }) => {
    if (!isInTable(state)) {
      return false;
    }
    const $cell = selectionCell(state);
    // #region REVIEW: CHANGED CODE:
    // If the target cell has an attribute, but the others in the selection do not,
    // then it does not apply the attribute to the others
    // Need delete this logic
    // if ($cell.nodeAfter!.attrs[name] === value) {
    // 	return false;
    // }
    // #endregion
    if (dispatch) {
      const tr = state.tr;
      if (state.selection instanceof CellSelection) {
        state.selection.forEachCell((node, pos) => {
          if (node.attrs[name] !== value) {
            tr.setNodeMarkup(pos, null, {
              ...node.attrs,
              [name]: value,
            });
          }
        });
      } else {
        tr.setNodeMarkup($cell.pos, null, {
          ...$cell.nodeAfter!.attrs,
          [name]: value,
        });
      }
      dispatch(tr);
    }
    return true;
  };
}

function goToNextCellOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return goToNextCell(1)(state, dispatch);
  };
}

/* ─── Borders (MS Word "Borders" feature) ────────────────────────────────
   Word semantics: pen/presets act on the selection rectangle — selectedRect
   covers the caret-in-cell case with a 1×1 rect. The "No borders" / "All
   borders" presets always target the whole table (owner's decision).
   setNodeMarkup keeps node sizes, so cell positions collected up front stay
   valid across the loop (same pattern as setCellsAttribute above). */

interface BorderTarget {
  node: ProseMirrorNode;
  sides: Set<BorderSideName>;
}

/** Distinct cells of the rect (merged cells deduped by their top-left pos),
   mapped to the sides each of them should receive. TableMap offsets are
   relative to the table content start — they are converted to absolute doc
   positions here, so the collected nodes are the cells themselves. */
function collectRectTargets(
  doc: ProseMirrorNode,
  rect: TableRect,
  sidesFor: (cellRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }) => BorderSideName[],
): Map<number, BorderTarget> {
  const targets = new Map<number, BorderTarget>();
  for (let row = rect.top; row < rect.bottom; row += 1) {
    for (let col = rect.left; col < rect.right; col += 1) {
      const offset = rect.map.map[row * rect.map.width + col];
      const pos = rect.tableStart + offset;
      if (targets.has(pos)) continue;
      const node = doc.nodeAt(pos);
      if (!node) continue;
      const sides = sidesFor(rect.map.findCell(offset));
      targets.set(pos, { node, sides: new Set(sides) });
    }
  }
  return targets;
}

function collectAllCells(
  doc: ProseMirrorNode,
  rect: TableRect,
  sides: BorderSideName[],
): Map<number, BorderTarget> {
  return collectRectTargets(doc, rect, () => sides);
}

/** The whole table as a rect — for the table-wide presets and for the
   "inside" presets fired from a bare caret (a 1×1 rect has no inner edges). */
function fullTableRect(state: EditorState): TableRect {
  const $cell = selectionCell(state);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  return {
    table,
    tableStart: $cell.start(-1),
    map,
    left: 0,
    top: 0,
    right: map.width,
    bottom: map.height,
  };
}

function applyBorderTargets(
  tr: Transaction,
  targets: Map<number, BorderTarget>,
  pen: BorderPen | null,
) {
  for (const [pos, { node, sides }] of targets) {
    const current = (node.attrs.borders ?? null) as CellBorders | null;
    const next: CellBorders = { ...(current ?? {}) };
    let changed = false;
    for (const side of sides) {
      if (pen) {
        const spec = penToSide(pen);
        if (JSON.stringify(next[side] ?? null) !== JSON.stringify(spec)) {
          next[side] = spec;
          changed = true;
        }
      } else if (next[side]) {
        delete next[side];
        changed = true;
      }
    }
    if (!changed) continue;
    const value: CellBorders | null = Object.keys(next).length ? next : null;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, borders: value });
  }
}

/** Apply (pen) or clear (null) the given sides on every cell of the
   selection — side buttons "top/bottom/left/right". */
function setCellsBorders(
  this: AddCommandsThis,
  pen: BorderPen | null,
  sides: BorderSideName[],
): Command {
  return ({ state, dispatch }) => {
    if (!isInTable(state) || !sides.length) {
      return false;
    }
    if (dispatch) {
      const tr = state.tr;
      applyBorderTargets(tr, collectAllCells(state.doc, selectedRect(state), sides), pen);
      dispatch(tr);
    }
    return true;
  };
}

/** Side-button toggle (the Word dialog's edge-click behavior): when every
   targeted side already matches the pen, remove it; otherwise apply. */
function toggleCellsBorders(
  this: AddCommandsThis,
  pen: BorderPen,
  sides: BorderSideName[],
): Command {
  return ({ state, dispatch }) => {
    if (!isInTable(state) || !sides.length) {
      return false;
    }
    if (dispatch) {
      const targets = collectAllCells(state.doc, selectedRect(state), sides);
      const allMatch = [...targets.values()].every(({ node }) => {
        const borders = (node.attrs.borders ?? null) as CellBorders | null;
        return sides.every((side) => sideMatchesPen(borders?.[side], pen));
      });
      const tr = state.tr;
      applyBorderTargets(tr, targets, allMatch ? null : pen);
      dispatch(tr);
    }
    return true;
  };
}

/** "Outer border" — pen on the WHOLE table's perimeter (table-wide scope,
   like "No borders" / "All borders" — owner's decision). */
function setBordersBox(this: AddCommandsThis, pen: BorderPen): Command {
  return ({ state, dispatch }) => {
    if (!isInTable(state)) {
      return false;
    }
    if (dispatch) {
      const rect = fullTableRect(state);
      const targets = collectRectTargets(state.doc, rect, (c) => {
        const sides: BorderSideName[] = [];
        if (c.top === rect.top) sides.push("top");
        if (c.left === rect.left) sides.push("left");
        if (c.bottom === rect.bottom) sides.push("bottom");
        if (c.right === rect.right) sides.push("right");
        return sides;
      });
      const tr = state.tr;
      applyBorderTargets(tr, targets, pen);
      dispatch(tr);
    }
    return true;
  };
}

/** "All borders" — pen on every side of every cell of the whole table
   (the Word "apply the current pen to the grid" semantics). The table-level
   borderless attr is lifted: the table is explicitly fully bordered, and
   cells inserted later should show the default grid. */
function applyTableBorders(this: AddCommandsThis, pen: BorderPen): Command {
  return ({ state, dispatch }) => {
    if (!isInTable(state)) {
      return false;
    }
    if (dispatch) {
      const rect = fullTableRect(state);
      const tr = state.tr;
      applyBorderTargets(
        tr,
        collectAllCells(state.doc, rect, BORDER_SIDES),
        pen,
      );
      if (rect.table.attrs.borders != null) {
        tr.setNodeMarkup(rect.tableStart - 1, undefined, {
          ...rect.table.attrs,
          borders: null,
        });
      }
      dispatch(tr);
    }
    return true;
  };
}

/** Inner gridlines: horizontal → each cell with a neighbor below draws its
   bottom; vertical → each cell with a neighbor to the right draws its right.
   From a multi-cell selection the inner lines of that rectangle are drawn;
   from a bare caret (a 1×1 rect has no inner edges) — the whole table's. */
function setBordersInside(
  this: AddCommandsThis,
  pen: BorderPen,
  direction: "horizontal" | "vertical",
): Command {
  return ({ state, dispatch }) => {
    if (!isInTable(state)) {
      return false;
    }
    if (dispatch) {
      let rect = selectedRect(state);
      if (rect.right - rect.left === 1 && rect.bottom - rect.top === 1) {
        rect = fullTableRect(state);
      }
      const targets = collectRectTargets(
        state.doc,
        rect,
        direction === "horizontal"
          ? (c) => (c.bottom < rect.bottom ? ["bottom"] : [])
          : (c) => (c.right < rect.right ? ["right"] : []),
      );
      const tr = state.tr;
      applyBorderTargets(tr, targets, pen);
      dispatch(tr);
    }
    return true;
  };
}

/** "No borders" — the whole table: clear every cell's borders and set
   `borders: "none"` on the table node; CSS suppresses the default grid
   (also for cells inserted later). */
function removeTableBorders(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    if (!isInTable(state)) {
      return false;
    }
    if (dispatch) {
      const rect = fullTableRect(state);
      const tr = state.tr;
      applyBorderTargets(tr, collectAllCells(state.doc, rect, BORDER_SIDES), null);
      if (rect.table.attrs.borders !== "none") {
        tr.setNodeMarkup(rect.tableStart - 1, undefined, {
          ...rect.table.attrs,
          borders: "none",
        });
      }
      dispatch(tr);
    }
    return true;
  };
}

function goToPreviousCellOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    return goToNextCell(-1)(state, dispatch);
  };
}

function fixTablesOverride(this: AddCommandsThis): Command {
  return ({ state, dispatch }) => {
    if (dispatch) {
      fixTables(state);
    }

    return true;
  };
}

function setCellSelection(
  this: AddCommandsThis,
  position: { anchorCell: number; headCell: number },
): Command {
  return ({ tr, dispatch }) => {
    if (dispatch) {
      const selection = new TextoCellSelection(
        tr.doc.resolve(position.anchorCell),
        tr.doc.resolve(position.headCell),
      );
      tr.setSelection(selection);
    }

    return true;
  };
}

export function addCommands(this: AddCommandsThis) {
  return {
    insertTable: insertTable.bind(this),
    addColumnBefore: addColumnBeforeOverride.bind(this),
    setCellSelection: setCellSelection.bind(this),
    fixTables: fixTablesOverride.bind(this),
    goToPreviousCell: goToPreviousCellOverride.bind(this),
    goToNextCell: goToNextCellOverride.bind(this),
    setCellsAttribute: setCellsAttribute.bind(this),
    setCellsBorders: setCellsBorders.bind(this),
    toggleCellsBorders: toggleCellsBorders.bind(this),
    setBordersBox: setBordersBox.bind(this),
    applyTableBorders: applyTableBorders.bind(this),
    setBordersInside: setBordersInside.bind(this),
    removeTableBorders: removeTableBorders.bind(this),
    mergeOrSplit: mergeOrSplit.bind(this),
    toggleHeaderCell: toggleHeaderCellOverride.bind(this),
    toggleHeaderRow: toggleHeaderRow.bind(this),
    toggleHeaderColumn: toggleHeaderColumn.bind(this),
    splitCell: splitCellOverride.bind(this),
    addColumnAfter: addColumnAfterOverride.bind(this),
    deleteColumn: deleteColumnOverride.bind(this),
    addRowBefore: addRowBeforeOverride.bind(this),
    mergeCells: mergeCellsOverride.bind(this),
    deleteTable: deleteTableOverride.bind(this),
    deleteRow: deleteRowOverride.bind(this),
    addRowAfter: addRowAfterOverride.bind(this),
    clearTable: clearTable.bind(this),
  };
}
