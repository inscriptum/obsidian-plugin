import { Fragment, Slice, type Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import {
  CellSelection,
  deleteRow,
  deleteTable,
  isInTable,
  selectionCell,
  selectedRect,
  TableMap,
  tableNodeTypes,
  type TableRect,
} from "prosemirror-tables";

import { TextoCellSelection } from "./TextoCellSelection";

/**
 * Table clipboard semantics (owner decisions, issue table-clipboard):
 *
 * - Cmd+C — stock ProseMirror copy of the CellSelection content (works as is;
 *   this module only makes sure the editor is focused after a cell drag, see
 *   handleMouseDown.stop).
 * - Cmd+V onto a cell selection — the copied cell block replaces the CONTENT
 *   of the selected rectangle; target cell attributes (fill, widths, borders,
 *   spans) are preserved, so the target table structure never changes. The
 *   source grid tiles over a larger target rectangle (Excel behavior).
 * - Cmd+V with a bare caret in a cell — a single copied cell replaces the
 *   caret cell's content; several copied cells/rows are INSERTED as new rows
 *   after the caret row, aligned to the target column count: extra source
 *   columns are dropped, missing ones become empty cells.
 * - Cmd+X — Excel semantics: a full-row selection removes those rows, a
 *   partial rectangle clears the cell contents. Either way the copied block
 *   goes to the system clipboard first.
 *
 * Without the paste override the table fragment raced past
 * prosemirror-tables' pastedCells (its shape assumptions are stricter than
 * what our clipboard round-trip produces) and ended up as a nested table
 * inside a cell.
 */

function isCellLike(node: ProseMirrorNode): boolean {
  // .spec is untyped (any) in prosemirror-model — cast explicitly.
  const role = node.type.spec.tableRole as string | undefined;
  return role === "cell" || role === "header_cell";
}

/** Attrs for a cell created from a clipboard-parsed source node. Parsed
 *  attrs are untrusted: dataColor can be a non-string (the parseHTML quirk
 *  of the data-color dataset) and only a well-formed color may reach
 *  renderHTML's safeColorValue. */
function insertedCellAttrs(source: ProseMirrorNode, span: number): Record<string, unknown> {
  const attrs = source.attrs as Record<string, unknown>;
  const dataColor = attrs.dataColor;
  return {
    ...attrs,
    colspan: span,
    rowspan: 1,
    dataColor: typeof dataColor === "string" ? dataColor : null,
  };
}

/**
 * The rectangular cell grid carried by a clipboard slice: an array of rows,
 * each an array of cell nodes. Accepts the shapes a table copy produces —
 * bare rows, a whole table node, or a run of cells (a single-cell copy with
 * open depths). Returns null for plain (non-table) content.
 */
export function extractCellGrid(slice: Slice): Array<Array<ProseMirrorNode>> | null {
  let content = slice.content;
  for (let i = 0; i < 4 && content.childCount === 1; i += 1) {
    // .spec is untyped (any) in prosemirror-model — cast explicitly.
    if ((content.child(0).type.spec.tableRole as string | undefined) !== "table") {
      break;
    }
    content = content.child(0).content;
  }

  const rows: Array<Array<ProseMirrorNode>> = [];
  let cellRun: Array<ProseMirrorNode> = [];
  const flushRun = () => {
    if (cellRun.length) {
      rows.push(cellRun);
      cellRun = [];
    }
  };

  for (let i = 0; i < content.childCount; i += 1) {
    const child = content.child(i);
    const role = child.type.spec.tableRole as string | undefined;
    if (role === "row") {
      flushRun();
      const cells: Array<ProseMirrorNode> = [];
      for (let c = 0; c < child.childCount; c += 1) {
        if (isCellLike(child.child(c))) {
          cells.push(child.child(c));
        }
      }
      if (cells.length) {
        rows.push(cells);
      }
    } else if (isCellLike(child)) {
      cellRun.push(child);
    } else {
      return null;
    }
  }
  flushRun();

  return rows.length ? rows : null;
}

/** Offset of the start of the row with the given index, in table content
 *  coordinates (TableMap.positionAt targets a cell column, not a row edge). */
function rowStartOffset(table: ProseMirrorNode, rowIndex: number): number {
  let offset = 0;
  for (let i = 0; i < rowIndex; i += 1) {
    offset += table.child(i).nodeSize;
  }
  return offset;
}

/** Replace the content of the selected rectangle with the copied grid.
 *  Target cell nodes survive with their attributes; only the content is
 *  swapped, so spans, widths, fill and borders come from the target. Cells
 *  outside the rectangle (in the same rows) are kept unchanged. */
function replaceRectWithGrid(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  rect: TableRect,
  grid: Array<Array<ProseMirrorNode>>,
): void {
  const { map, table, tableStart } = rect;
  const gridH = grid.length;
  const gridW = Math.max(...grid.map((row) => row.length));

  const newRows: Array<ProseMirrorNode> = [];
  for (let row = rect.top; row < rect.bottom; row += 1) {
    const rowNode = table.child(row);
    const rowStart = rowStartOffset(table, row);
    const rowEnd = rowStart + rowNode.nodeSize;
    const gridRow = grid[(row - rect.top) % gridH];
    const cells: Array<ProseMirrorNode> = [];
    const seenOffsets = new Set<number>();
    let gridCol = 0;
    for (let col = 0; col < map.width; col += 1) {
      const offset = map.map[row * map.width + col];
      if (seenOffsets.has(offset)) {
        continue; // colspan continuation — the cell is already built
      }
      seenOffsets.add(offset);
      if (offset < rowStart || offset >= rowEnd) {
        continue; // rowspan continuation — nothing in this row node
      }
      const target = table.nodeAt(offset);
      if (!target) {
        continue;
      }
      const span = target.attrs.colspan as number;
      const insideRect = col >= rect.left && col + span <= rect.right;
      const source = insideRect ? gridRow[gridCol % gridW] : null;
      if (insideRect && source) {
        cells.push(target.type.create(target.attrs, source.content));
      } else {
        cells.push(target);
      }
      if (insideRect) {
        gridCol += span;
      }
    }
    newRows.push(rowNode.copy(Fragment.fromArray(cells)));
  }

  let replacedSize = 0;
  for (let row = rect.top; row < rect.bottom; row += 1) {
    replacedSize += table.child(row).nodeSize;
  }
  const from = tableStart + rowStartOffset(table, rect.top);

  const tr = state.tr;
  tr.replace(from, from + replacedSize, new Slice(Fragment.fromArray(newRows), 0, 0));

  // Restore the rectangle selection in the new document. Content sizes
  // changed, so old positions are useless here: the structure (rows, spans)
  // did not change, so the same rect indexes address the same cells in the
  // new table. cellsInRect skips span continuations — its ends are the
  // visible corner cells.
  const newTable = tr.doc.nodeAt(tableStart - 1);
  if (!newTable) {
    dispatch(tr);
    return;
  }
  const rectCells = TableMap.get(newTable).cellsInRect(rect);
  const selection = new TextoCellSelection(
    tr.doc.resolve(tableStart + rectCells[0]),
    tr.doc.resolve(tableStart + rectCells[rectCells.length - 1]),
  );
  tr.setSelection(selection).scrollIntoView();
  dispatch(tr);
}

/** Insert the copied rows as new rows after the caret row, aligned to the
 *  target column count (extra source columns dropped, missing ones become
 *  empty cells). The new rows mirror the caret row's cell type. */
function insertRowsAfterCaret(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  grid: Array<Array<ProseMirrorNode>>,
): boolean {
  const $cell = selectionCell(state);
  const table = $cell.node(-1);
  const tableStart = $cell.start(-1);
  const map = TableMap.get(table);
  const targetWidth = map.width;
  const cursorRect = map.findCell($cell.pos - tableStart);
  const insertAfterRow = cursorRect.bottom; // the row below the caret row
  const referenceRow = table.child(Math.min(insertAfterRow - 1, table.childCount - 1));
  const cellType = referenceRow.childCount
    ? referenceRow.child(0).type
    : tableNodeTypes(state.schema).cell;

  const newRows: Array<ProseMirrorNode> = [];
  for (const sourceRow of grid) {
    const cells: Array<ProseMirrorNode> = [];
    let col = 0;
    for (const sourceCell of sourceRow) {
      if (col >= targetWidth) {
        break; // extra source columns are ignored (owner decision)
      }
      const span = Math.min(sourceCell.attrs.colspan as number, targetWidth - col);
      cells.push(cellType.create(insertedCellAttrs(sourceCell, span), sourceCell.content));
      col += span;
    }
    while (col < targetWidth) {
      const empty = cellType.createAndFill();
      if (!empty) {
        return false;
      }
      cells.push(empty);
      col += 1;
    }
    newRows.push(state.schema.nodes.tableRow.createChecked(null, cells));
  }

  const tr = state.tr;
  const pos = tableStart + rowStartOffset(table, insertAfterRow);
  tr.insert(pos, Fragment.fromArray(newRows));
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(pos + 1))));
  tr.scrollIntoView();
  dispatch(tr);
  return true;
}

/** Paste handling for table fragments (owner semantics above). Returns false
 *  for non-table content so the default paste path takes over. */
function handleCellPaste(view: EditorView, slice: Slice): boolean {
  const { state } = view;
  const grid = extractCellGrid(slice);
  if (!grid) {
    return false;
  }
  const dispatch = view.dispatch.bind(view);
  const { selection } = state;
  if (selection instanceof CellSelection) {
    replaceRectWithGrid(state, dispatch, selectedRect(state), grid);
    return true;
  }
  if (!isInTable(state)) {
    return false;
  }
  // Excel: a single copied cell pasted at a caret replaces the caret cell's
  // content (target attributes preserved), it does not insert a row.
  if (grid.length === 1 && grid[0].length === 1) {
    const $cell = selectionCell(state);
    const table = $cell.node(-1);
    const tableStart = $cell.start(-1);
    const map = TableMap.get(table);
    const cellOffset = $cell.pos - tableStart;
    const cellPos = tableStart + map.map[map.findCell(cellOffset).top * map.width + map.colCount(cellOffset)];
    const target = state.doc.nodeAt(cellPos);
    if (!target) {
      return false;
    }
    const tr = state.tr;
    tr.replace(
      tr.mapping.map(cellPos + 1),
      tr.mapping.map(cellPos + target.nodeSize - 1),
      new Slice(grid[0][0].content, 0, 0),
    );
    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(cellPos + 1))));
    tr.scrollIntoView();
    dispatch(tr);
    return true;
  }
  return insertRowsAfterCaret(state, dispatch, grid);
}

/**
 * Cmd+X for a cell selection: the copied block goes to the system clipboard,
 * then Excel semantics — full rows are removed, a partial rectangle only
 * clears cell contents. Returns false outside a cell selection (normal cut).
 */
export function cutCellSelection(view: EditorView): boolean {
  const { state } = view;
  const { selection } = state;
  if (!(selection instanceof CellSelection) || selection.empty || !isInTable(state)) {
    return false;
  }

  const content = selection.content();
  const { dom, text } = view.serializeForClipboard(content);
  void copyToSystemClipboard(dom.innerHTML, text);

  const rect = selectedRect(state);
  const fullRows = rect.left === 0 && rect.right === rect.map.width;
  if (fullRows) {
    // deleteRow refuses to remove every row of a table; cutting all rows
    // removes the table itself — an empty table is not a valid document
    // node (mirrors deleteTableWhenAllCellsSelected for Backspace).
    const wholeTable = rect.top === 0 && rect.bottom === rect.map.height;
    (wholeTable ? deleteTable : deleteRow)(state, view.dispatch.bind(view));
  } else {
    view.dispatch(state.tr.deleteSelection().scrollIntoView());
  }
  return true;
}

async function copyToSystemClipboard(html: string, text: string): Promise<void> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return;
    }
  } catch {
    // fall through to the plain-text path
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // no clipboard access — nothing else to do
  }
}

export function cellClipboardPlugin(): Plugin {
  return new Plugin({
    props: {
      // Registered before tableEditing: returning false falls through to its
      // handlePaste and then to the default paste handling.
      handlePaste: (view, _event, slice) => {
        if (!isInTable(view.state)) {
          return false;
        }
        return handleCellPaste(view, slice);
      },
    },
  });
}
