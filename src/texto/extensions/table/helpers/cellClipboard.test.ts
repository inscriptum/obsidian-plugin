import type { Node as ProseMirrorNode } from "prosemirror-model";
import { DOMParser, DOMSerializer, Fragment, Slice } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { CellSelection } from "prosemirror-tables";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSchema } from "../../../../../tests/helpers/buildSchema";

import { cellClipboardPlugin, copyTableSelection, cutCellSelection, cutTableSelection, extractCellGrid, gridToTsv, pasteFromSystemClipboard, tsvToHtml } from "./cellClipboard";
import { TextoCellSelection } from "./TextoCellSelection";

const schema = buildSchema();

function cell(text: string, attrs: Record<string, unknown> = {}): ProseMirrorNode {
  return schema.nodes.tableCell.create(attrs, [
    schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []),
  ]);
}

function row(cells: Array<ProseMirrorNode>): ProseMirrorNode {
  return schema.nodes.tableRow.create(null, cells);
}

function table(rows: Array<ProseMirrorNode>): ProseMirrorNode {
  return schema.nodes.table.create(
    { data: { rowsCount: rows.length, colsCount: rows[0]?.childCount ?? 0 } },
    rows,
  );
}

function boldCell(text: string): ProseMirrorNode {
  return schema.nodes.tableCell.create(null, [
    schema.nodes.paragraph.create(null, [schema.text(text, [schema.marks.bold.create()])]),
  ]);
}

function headerCell(text: string): ProseMirrorNode {
  return schema.nodes.tableHeader.create(null, [
    schema.nodes.paragraph.create(null, [schema.text(text)]),
  ]);
}

/** A doc with two plain 2x2 body tables and a paragraph between them. */
function twoTablesDoc(): ProseMirrorNode {
  const cellA = (t: string) => cell(t);
  return schema.nodes.noteDoc.create(null, [
    schema.nodes.noteTitle.create(null, [schema.text("T")]),
    table([
      row([cellA("A00"), cellA("A01")]),
      row([cellA("A10"), cellA("A11")]),
    ]),
    schema.nodes.paragraph.create(null, [schema.text("between")]),
    table([
      row([cell("B00"), cell("B01")]),
      row([cell("B10"), cell("B11")]),
    ]),
  ]);
}

function cellPositions(doc: ProseMirrorNode, tableIndex = 0): number[] {
  const positions: number[] = [];
  let seen = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "table") {
      seen += 1;
      return seen === tableIndex;
    }
    if (seen === tableIndex && (node.type.name === "tableCell" || node.type.name === "tableHeader")) {
      positions.push(pos);
    }
    return true;
  });
  return positions;
}

function cellTexts(doc: ProseMirrorNode, tableIndex = 0): string[] {
  const texts: string[] = [];
  let seen = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "table") {
      seen += 1;
      return seen === tableIndex;
    }
    if (seen === tableIndex && (node.type.name === "tableCell" || node.type.name === "tableHeader")) {
      texts.push(node.textContent);
    }
    return true;
  });
  return texts;
}

function stateWithSelection(doc: ProseMirrorNode, selection: CellSelection | TextSelection): EditorState {
  return EditorState.create({
    doc,
    selection,
    plugins: [cellClipboardPlugin()],
  });
}

/** A fake view: handlePaste/cutCellSelection only need state, dispatch and
 *  serializeForClipboard (real layout is not involved in these paths). */
function fakeView(state: EditorState, onDispatch: (tr: import("prosemirror-state").Transaction) => void): EditorView {
  const serializer = DOMSerializer.fromSchema(state.schema);
  return {
    state,
    dispatch: (tr: import("prosemirror-state").Transaction) => onDispatch(tr),
    serializeForClipboard: (slice: Slice) => {
      const dom = createDiv();
      dom.appendChild(serializer.serializeFragment(slice.content));
      return { dom, text: slice.content.textBetween(0, slice.content.size, "\n\n"), slice };
    },
  } as unknown as EditorView;
}

function paste(state: EditorState, slice: Slice): EditorState {
  let next = state;
  const plugin = state.plugins.find((p) => p.spec.props?.handlePaste);
  const handlePaste = plugin?.spec.props?.handlePaste as
    | ((view: EditorView, event: unknown, slice: Slice) => boolean)
    | undefined;
  expect(handlePaste).toBeDefined();
  handlePaste?.(fakeView(state, (tr) => { next = state.apply(tr); }), {}, slice);
  return next;
}

function rectSelection(doc: ProseMirrorNode, tableIndex: number): CellSelection {
  const [p1, , , p4] = cellPositions(doc, tableIndex);
  return new CellSelection(doc.resolve(p1), doc.resolve(p4));
}

describe("extractCellGrid", () => {
  it("reads bare rows", () => {
    const grid = extractCellGrid(new Slice(Fragment.fromArray([row([cell("a"), cell("b")])]), 1, 1));
    expect(grid).toHaveLength(1);
    expect(grid?.[0]).toHaveLength(2);
    expect(grid?.[0][0].textContent).toBe("a");
  });

  it("unwraps a whole table copy", () => {
    const t = table([row([cell("a")]), row([cell("b")])]);
    const grid = extractCellGrid(new Slice(Fragment.from(t), 1, 1));
    expect(grid).toHaveLength(2);
  });

  it("reads a single-cell slice (open depths)", () => {
    const grid = extractCellGrid(new Slice(Fragment.from(cell("a")), 1, 1));
    expect(grid).toHaveLength(1);
    expect(grid?.[0][0].textContent).toBe("a");
  });

  it("rejects plain content", () => {
    const para = schema.nodes.paragraph.create(null, [schema.text("x")]);
    expect(extractCellGrid(new Slice(Fragment.from(para), 0, 0))).toBeNull();
  });
});

describe("paste onto a cell selection", () => {
  it("replaces the target rect content and preserves target cell attrs", () => {
    // Source: S01 carries bold text; S10 carries a background color attr.
    const sourceRows = [
      row([cell("S00"), boldCell("S01")]),
      row([cell("S10", { backgroundColor: "#ff0000" }), cell("S11")]),
    ];

    // Target: B00 has its own background color and wider column — both must
    // survive the paste (only content is replaced).
    const withAttrs = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(null, [schema.text("T")]),
      table([row([cell("B00"), cell("B01")]), row([cell("B10"), cell("B11")])]),
      schema.nodes.paragraph.create(null, [schema.text("between")]),
      table([
        row([cell("B00", { backgroundColor: "#00ff00", colwidth: [120] }), cell("B01")]),
        row([cell("B10"), cell("B11")]),
      ]),
    ]);
    const state = stateWithSelection(withAttrs, rectSelection(withAttrs, 1));
    const next = paste(state, new Slice(Fragment.fromArray(sourceRows), 1, 1));

    expect(cellTexts(next.doc, 1)).toEqual(["S00", "S01", "S10", "S11"]);
    // Target attrs preserved; source fill did not leak in.
    const target = cellPositions(next.doc, 1);
    const firstCell = next.doc.nodeAt(target[0]);
    expect(firstCell?.attrs.backgroundColor).toBe("#00ff00");
    expect(firstCell?.attrs.colwidth).toEqual([120]);
    // Inline formatting travels with the content.
    const secondCell = next.doc.nodeAt(target[1]);
    expect(secondCell?.firstChild?.firstChild?.marks).toHaveLength(1);
    // The selection is back over the same rectangle.
    expect(next.selection).toBeInstanceOf(CellSelection);
    // The source table is untouched.
    expect(cellTexts(next.doc, 0)).toEqual(["B00", "B01", "B10", "B11"]);
  });

  it("keeps the structure valid (trailing paragraphs in every cell)", () => {
    const doc = twoTablesDoc();
    const state = stateWithSelection(doc, rectSelection(doc, 1));
    const next = paste(state, new Slice(Fragment.from(cell("X")), 1, 1));
    const texts = cellTexts(next.doc, 1);
    expect(texts).toEqual(["X", "X", "X", "X"]);
    let cells = 0;
    next.doc.descendants((node) => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        cells += 1;
        expect(node.lastChild?.type.name).toBe("paragraph");
      }
      return true;
    });
    expect(cells).toBe(8);
  });

  it("tiles a 1x1 copy over a larger rect and keeps spans", () => {
    const doc = twoTablesDoc();
    const state = stateWithSelection(doc, rectSelection(doc, 1));
    const next = paste(state, new Slice(Fragment.from(cell("Z")), 1, 1));
    expect(cellTexts(next.doc, 1)).toEqual(["Z", "Z", "Z", "Z"]);
  });

  it("keeps cells outside the rectangle untouched", () => {
    // Target: 3 columns; the selection covers columns 0-1 of both body rows.
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(null, [schema.text("T")]),
      table([
        row([cell("A0"), cell("A1")]),
        row([cell("A2"), cell("A3")]),
      ]),
      schema.nodes.paragraph.create(null, [schema.text("between")]),
      table([
        row([cell("B00"), cell("B01"), cell("KEEP1")]),
        row([cell("B10"), cell("B11"), cell("KEEP2")]),
      ]),
    ]);
    const positions = cellPositions(doc, 1);
    const state = stateWithSelection(
      doc,
      new CellSelection(doc.resolve(positions[0]), doc.resolve(positions[4])),
    );
    const next = paste(state, new Slice(Fragment.fromArray([
      row([cell("X0"), cell("X1")]),
      row([cell("X2"), cell("X3")]),
    ]), 1, 1));
    expect(cellTexts(next.doc, 1)).toEqual(["X0", "X1", "KEEP1", "X2", "X3", "KEEP2"]);
  });

  it("pastes a whole-table copy onto a selection (the original bug shape)", () => {
    // A full-table copy travels as Slice([table], 1, 1); pasting it used to
    // nest the table into the selected cells.
    const doc = twoTablesDoc();
    const sourceTable = table([
      row([cell("S0"), cell("S1")]),
      row([cell("S2"), cell("S3")]),
    ]);
    const state = stateWithSelection(doc, rectSelection(doc, 1));
    const next = paste(state, new Slice(Fragment.from(sourceTable), 1, 1));
    expect(cellTexts(next.doc, 1)).toEqual(["S0", "S1", "S2", "S3"]);
    // No nested table anywhere.
    let nested = 0;
    next.doc.descendants((node) => {
      if (node.type.name === "tableCell") {
        node.content.forEach((child) => {
          if (child.type.name === "table") nested += 1;
        });
      }
      return true;
    });
    expect(nested).toBe(0);
  });

  it("tiles source cells in order over a merged target cell", () => {
    // Target: col 0 spans two columns (colspan 2), col 2 is separate.
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(null, [schema.text("T")]),
      table([row([cell("A0"), cell("A1")])]),
      schema.nodes.paragraph.create(null, [schema.text("between")]),
      table([
        row([
          schema.nodes.tableCell.create({ colspan: 2 }, [
            schema.nodes.paragraph.create(null, [schema.text("WIDE")]),
          ]),
          cell("C"),
        ]),
      ]),
    ]);
    const positions = cellPositions(doc, 1);
    const state = stateWithSelection(
      doc,
      new CellSelection(doc.resolve(positions[0]), doc.resolve(positions[1])),
    );
    const next = paste(state, new Slice(Fragment.fromArray([
      row([cell("X"), cell("Y")]),
    ]), 1, 1));
    // The merged cell takes the first source cell, C takes the second one.
    expect(cellTexts(next.doc, 1)).toEqual(["X", "Y"]);
    const target = next.doc.nodeAt(positions[0]);
    expect(target?.attrs.colspan).toBe(2);
  });

  it("pastes header cells onto a header selection", () => {
    const doc = twoTablesDoc(); // both tables have header rows
    const positions = cellPositions(doc, 1);
    const state = stateWithSelection(
      doc,
      new CellSelection(doc.resolve(positions[0]), doc.resolve(positions[1])),
    );
    const next = paste(state, new Slice(Fragment.fromArray([
      row([headerCell("H0"), headerCell("H1")]),
    ]), 1, 1));
    expect(cellTexts(next.doc, 1)).toEqual(["H0", "H1", "B10", "B11"]);
  });
});

describe("paste at a caret", () => {
  it("single copied cell replaces the caret cell content", () => {
    const doc = twoTablesDoc();
    const [b0] = cellPositions(doc, 1);
    const state = stateWithSelection(doc, TextSelection.create(doc, b0 + 1));
    const next = paste(state, new Slice(Fragment.from(cell("Q")), 1, 1));
    expect(cellTexts(next.doc, 1)[0]).toBe("Q");
    expect(cellTexts(next.doc, 1)).toHaveLength(4);
  });

  it("copied rows are inserted after the caret row", () => {
    const doc = twoTablesDoc();
    const [b0] = cellPositions(doc, 1);
    const state = stateWithSelection(doc, TextSelection.create(doc, b0 + 1));
    const next = paste(state, new Slice(Fragment.fromArray([
      row([cell("R0a"), cell("R0b")]),
      row([cell("R1a"), cell("R1b")]),
    ]), 1, 1));
    expect(cellTexts(next.doc, 1)).toEqual([
      "B00", "B01",
      "R0a", "R0b",
      "R1a", "R1b",
      "B10", "B11",
    ]);
    expect(next.selection.from).toBeGreaterThan(b0);
  });

  it("aligns columns: extra source columns are dropped", () => {
    const doc = twoTablesDoc(); // target is 2 columns
    const [b0] = cellPositions(doc, 1);
    const state = stateWithSelection(doc, TextSelection.create(doc, b0 + 1));
    const next = paste(state, new Slice(Fragment.fromArray([
      row([cell("c0"), cell("c1"), cell("c2")]), // the 3rd column is dropped
    ]), 1, 1));
    expect(cellTexts(next.doc, 1)).toEqual([
      "B00", "B01",
      "c0", "c1",
      "B10", "B11",
    ]);
  });

  it("aligns columns: missing source columns become empty cells", () => {
    // Target is 3 columns, the source row has 2 cells — the third one pads.
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(null, [schema.text("T")]),
      table([row([cell("A0"), cell("A1"), cell("A2")])]),
      schema.nodes.paragraph.create(null, [schema.text("between")]),
      table([row([cell("B0"), cell("B1"), cell("B2")])]),
    ]);
    const [b0] = cellPositions(doc, 1);
    const state = stateWithSelection(doc, TextSelection.create(doc, b0 + 1));
    const next = paste(state, new Slice(Fragment.fromArray([
      row([cell("c0"), cell("c1")]),
    ]), 1, 1));
    expect(cellTexts(next.doc, 1)).toEqual(["B0", "B1", "B2", "c0", "c1", ""]);
    // The padded cell satisfies the trailing-paragraph invariant.
    const positions = cellPositions(next.doc, 1);
    const padded = next.doc.nodeAt(positions[5]);
    expect(padded?.lastChild?.type.name).toBe("paragraph");
  });

  it("inserts rows under a rowspan: merges extend, rows fill free columns", () => {
    // 3-col table; col 0 is merged across rows 0-1 (rowspan 2). The caret
    // sits in row 0, so the insertion point is crossed by the merge.
    const merged = schema.nodes.tableCell.create({ rowspan: 2 }, [
      schema.nodes.paragraph.create(null, [schema.text("M")]),
    ]);
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(null, [schema.text("T")]),
      table([
        row([merged, cell("c01"), cell("c02")]),
        row([cell("c11"), cell("c12")]),
        row([cell("c21"), cell("c22"), cell("c23")]),
      ]),
    ]);
    const positions = cellPositions(doc, 0);
    const state = stateWithSelection(doc, TextSelection.create(doc, positions[1] + 1));
    const next = paste(state, new Slice(Fragment.fromArray([
      row([cell("X"), cell("Y")]),
    ]), 1, 1));
    // The new row holds cells at the free columns (1-2) only; col 0 is the
    // extended merge.
    expect(cellTexts(next.doc, 0)).toEqual([
      "M", "c01", "c02",
      "X", "Y",
      "c11", "c12",
      "c21", "c22", "c23",
    ]);
    // The merge crossing the insertion point extended by one row.
    const mergedNode = next.doc.nodeAt(positions[0]);
    expect(mergedNode?.attrs.rowspan).toBe(3);
  });

  it("pastes a copied column at a caret: a new column, not rows", () => {
    // 3x2 target; the copy is a 2-cell vertical run (a column-shaped grid).
    const doc = twoTablesDoc();
    const [b0] = cellPositions(doc, 1);
    const state = stateWithSelection(doc, TextSelection.create(doc, b0 + 1));
    const next = paste(state, new Slice(Fragment.fromArray([
      row([cell("K0")]),
      row([cell("K1")]),
    ]), 1, 1));
    // A column is inserted right of the caret column, filled top down.
    expect(cellTexts(next.doc, 1)).toEqual([
      "B00", "K0", "B01",
      "B10", "K1", "B11",
    ]);
    // Still 2 rows — rows must not appear.
    let rowCount = 0;
    let seen = -1;
    next.doc.descendants((node) => {
      if (node.type.name === "table") { seen += 1; return seen === 1; }
      if (seen === 1 && node.type.name === "tableRow") rowCount += 1;
      return true;
    });
    expect(rowCount).toBe(2);
  });

  it("column paste fills only the available rows and keeps types", () => {
    // Target: header row + 1 body row; the copy is a 2-row single-cell grid
    // (a column) — both rows fill, the copy's second cell is dropped.
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(null, [schema.text("T")]),
      table([row([cell("A0"), cell("A1")])]),
      schema.nodes.paragraph.create(null, [schema.text("between")]),
      table([
        row([headerCell("Bh"), cell("B0")]),
        row([cell("B1"), cell("B2")]),
      ]),
    ]);
    const positions = cellPositions(doc, 1);
    const state = stateWithSelection(doc, TextSelection.create(doc, positions[1] + 1));
    const next = paste(state, new Slice(Fragment.fromArray([
      row([headerCell("K")]),
      row([cell("K2")]),
      row([cell("K3")]),
    ]), 1, 1));
    // The column is inserted right of the caret's column (B0 is the second
    // column); the third copied row is dropped (the target has only two).
    expect(cellTexts(next.doc, 1)).toEqual(["Bh", "B0", "K", "B1", "B2", "K2"]);
    // The filled cell of the header row is a header cell.
    const newTop = next.doc.nodeAt(cellPositions(next.doc, 1)[2]);
    expect(newTop?.type.name).toBe("tableHeader");
  });
});

describe("cut (Excel semantics)", () => {
  const flush = () => new Promise((r) => window.setTimeout(r, 0));

  function stubWriteOk(): void {
    (navigator as unknown as { clipboard: unknown }).clipboard = {
      writeText: async (t: string) => {
        void t;
      },
    };
  }

  function stubWriteDenied(): void {
    (navigator as unknown as { clipboard: unknown }).clipboard = {
      write: async () => {
        throw new Error("denied");
      },
      writeText: async () => {
        throw new Error("denied");
      },
    };
  }

  async function cutWith(state: EditorState, stub: () => void = stubWriteOk): Promise<{ dispatched: Array<import("prosemirror-state").Transaction>; next: EditorState }> {
    const dispatched: Array<import("prosemirror-state").Transaction> = [];
    stub();
    const view = {
      state,
      dispatch: (tr: import("prosemirror-state").Transaction) => dispatched.push(tr),
      serializeForClipboard: (slice: Slice) => ({
        dom: createDiv(),
        text: "",
        slice,
      }),
    } as unknown as EditorView;
    expect(cutCellSelection(view)).toBe(true);
    // The delete is dispatched only after the clipboard write confirmed.
    await flush();
    expect(dispatched).toHaveLength(1);
    return { dispatched, next: state.apply(dispatched[0]) };
  }

  it("removes full rows (a body row out of several)", async () => {
    // 3 body rows in the second table; select the middle one.
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(null, [schema.text("T")]),
      table([row([cell("A0")]), row([cell("A1")]), row([cell("A2")])]),
      schema.nodes.paragraph.create(null, [schema.text("between")]),
      table([row([cell("B0")]), row([cell("B1")]), row([cell("B2")])]),
    ]);
    const positions = cellPositions(doc, 1);
    const state = stateWithSelection(doc, new CellSelection(doc.resolve(positions[1])));
    const { next } = await cutWith(state);
    expect(cellTexts(next.doc, 1)).toEqual(["B0", "B2"]);
  });

  it("cutting every row removes the table (an empty table is invalid)", async () => {
    const doc = twoTablesDoc();
    const state = stateWithSelection(doc, rectSelection(doc, 1));
    const { next } = await cutWith(state);
    let tables = 0;
    next.doc.descendants((node) => {
      if (node.type.name === "table") tables += 1;
      return true;
    });
    expect(tables).toBe(1);
  });

  it("clears contents of a partial rectangle", async () => {
    const doc = twoTablesDoc();
    const [p1] = cellPositions(doc, 1);
    // Select only the first cell of the second table (1x1 "rect").
    const state = stateWithSelection(doc, new CellSelection(doc.resolve(p1)));
    const { next } = await cutWith(state);
    expect(cellTexts(next.doc, 1)).toEqual(["", "B01", "B10", "B11"]);
    // Structure survived: still 4 cells.
    expect(cellTexts(next.doc, 1)).toHaveLength(4);
  });

  it("a denied clipboard leaves the content intact (cut deletes only after the copy landed)", async () => {
    const doc = twoTablesDoc();
    const state = stateWithSelection(doc, rectSelection(doc, 1));
    const dispatched: Array<import("prosemirror-state").Transaction> = [];
    stubWriteDenied();
    const view = {
      state,
      dispatch: (tr: import("prosemirror-state").Transaction) => dispatched.push(tr),
      serializeForClipboard: (slice: Slice) => ({
        dom: createDiv(),
        text: "",
        slice,
      }),
    } as unknown as EditorView;
    expect(cutCellSelection(view)).toBe(true);
    await flush();
    expect(dispatched).toHaveLength(0);
    // Nothing was removed.
    expect(cellTexts(state.doc, 1)).toEqual(cellTexts(state.doc, 1));
    expect(cellTexts(view.state.doc, 1)).toEqual(["B00", "B01", "B10", "B11"]);
  });

  it("does not touch a plain caret cut", () => {
    const doc = twoTablesDoc();
    const state = stateWithSelection(doc, TextSelection.create(doc, 6));
    const view = fakeView(state, () => {
      throw new Error("must not dispatch");
    });
    expect(cutCellSelection(view)).toBe(false);
  });

  // The DOM cut event (issues/text-cut-mod-x): the Cmd+X path for cell
  // selections lives in the plugin's handleDOMEvents — NOT in the keymap,
  // whose Mod-x binding made the host router swallow every text cut.
  function pluginCut(view: EditorView): { handled: boolean; prevented: boolean } {
    const plugin = cellClipboardPlugin();
    const cut = plugin.spec.props?.handleDOMEvents?.cut as
      | ((view: EditorView, event: ClipboardEvent) => boolean)
      | undefined;
    expect(cut).toBeDefined();
    let prevented = false;
    const handled = cut!(view, {
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as ClipboardEvent);
    return { handled, prevented };
  }

  it("the DOM cut handler runs the Excel cut for a cell selection", async () => {
    stubWriteOk();
    const doc = twoTablesDoc();
    let next = stateWithSelection(doc, rectSelection(doc, 1));
    const view = fakeView(next, (tr) => {
      next = next.apply(tr);
    });
    const { handled, prevented } = pluginCut(view);
    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    await flush();
    // Full-row rect (2×2 of a 2-col table) → the row is gone.
    expect(cellTexts(next.doc, 1)).toEqual([]);
  });

  it("the DOM cut handler falls through for a text selection", () => {
    const doc = twoTablesDoc();
    const state = stateWithSelection(doc, TextSelection.create(doc, 6));
    const view = fakeView(state, () => {
      throw new Error("must not dispatch");
    });
    const { handled, prevented } = pluginCut(view);
    expect(handled).toBe(false);
    expect(prevented).toBe(false); // native cut proceeds untouched
  });
});

describe("toolbar clipboard buttons (caret 1×1 scope)", () => {
  /** Stub navigator.clipboard; captures the written payload as strings. */
  const stubClipboard = (captured: Record<string, string>) => {
    (navigator as unknown as { clipboard: unknown }).clipboard = {
      write: async (items: Array<{ types: string[]; getType: (t: string) => Promise<Blob> }>) => {
        for (const item of items) {
          for (const type of item.types) {
            captured[type] = await (await item.getType(type)).text();
          }
        }
      },
      writeText: async (t: string) => {
        captured["text/plain"] = t;
      },
      read: async () => [],
      readText: async () => "",
    };
  };

  const fakeView = (state: EditorState, dispatched: Array<import("prosemirror-state").Transaction>) =>
    ({
      state,
      dispatch: (tr: import("prosemirror-state").Transaction) => dispatched.push(tr),
      serializeForClipboard: (slice: Slice) => {
        const dom = createDiv();
        dom.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(slice.content));
        return { dom, text: slice.content.textBetween(0, slice.content.size, "\n\n"), slice };
      },
    }) as unknown as EditorView;

  it("copyTableSelection copies the caret cell as a 1×1 table", async () => {
    const captured: Record<string, string> = {};
    stubClipboard(captured);
    const doc = twoTablesDoc();
    const [b0] = cellPositions(doc, 1);
    const state = stateWithSelection(doc, TextSelection.create(doc, b0 + 1));
    expect(copyTableSelection(fakeView(state, []))).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    // jsdom has no ClipboardItem — the write degrades to plain text, which
    // is exactly the fallback the production code promises.
    expect(captured["text/plain"]).toContain("B00");
  });

  it("cutTableSelection clears the caret cell", async () => {
    const captured: Record<string, string> = {};
    stubClipboard(captured);
    const doc = twoTablesDoc();
    const [b0] = cellPositions(doc, 1);
    const state = stateWithSelection(doc, TextSelection.create(doc, b0 + 1));
    const dispatched: Array<import("prosemirror-state").Transaction> = [];
    expect(await cutTableSelection(fakeView(state, dispatched))).toBe(true);
    await new Promise((r) => window.setTimeout(r, 0));
    expect(dispatched).toHaveLength(1);
    const next = state.apply(dispatched[0]);
    expect(cellTexts(next.doc, 1)[0]).toBe("");
  });

  it("both no-op outside a table", () => {
    const state = stateWithSelection(twoTablesDoc(), TextSelection.create(twoTablesDoc(), 1));
    const view = {
      state,
      dispatch: () => {},
      serializeForClipboard: () => ({ dom: createDiv(), text: "", slice: null }),
    } as unknown as EditorView;
    expect(copyTableSelection(view)).toBe(false);
    void cutTableSelection(view); // must not throw; result checked below
    return cutTableSelection(view).then((r) => expect(r).toBe(false));
  });
});

describe("system clipboard (toolbar button path)", () => {
  const flush = () => new Promise((r) => window.setTimeout(r, 0));
  const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36";
  const DESKTOP_UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
  const realUA = navigator.userAgent;
  const realClipboard = (navigator as unknown as { clipboard: unknown }).clipboard;
  const realClipboardItem = (globalThis as unknown as Record<string, unknown>).ClipboardItem;

  afterEach(() => {
    // stubs leak into later tests in this file otherwise
    setUA(realUA);
    stubClipboard(realClipboard as Record<string, unknown>);
    (globalThis as unknown as Record<string, unknown>).ClipboardItem = realClipboardItem;
  });

  function setUA(ua: string): void {
    Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
  }

  function stubClipboard(stub: Record<string, unknown>): void {
    (navigator as unknown as { clipboard: unknown }).clipboard = stub;
  }

  /** ClipboardItem is undefined in jsdom — a data-carrier stub for the rich
   *  write branch. */
  class FakeClipboardItem {
    data: Record<string, Blob>;
    constructor(data: Record<string, Blob>) {
      this.data = data;
    }
  }

  function cellSelectionState(): EditorState {
    const doc = twoTablesDoc();
    return stateWithSelection(doc, rectSelection(doc, 0));
  }

  /** A view mock with a real event target so pasteFromSystemClipboard's
   *  synthetic paste event can be observed. */
  function clipboardView(state: EditorState): { view: EditorView; events: ClipboardEvent[] } {
    const events: ClipboardEvent[] = [];
    const dom = createDiv();
    dom.addEventListener("paste", (e) => events.push(e as ClipboardEvent));
    const serializer = DOMSerializer.fromSchema(state.schema);
    const view = {
      state,
      dispatch: () => {},
      focus: () => {},
      dom,
      serializeForClipboard: (slice: Slice) => {
        const el = createDiv();
        el.appendChild(serializer.serializeFragment(slice.content));
        return { dom: el, text: slice.content.textBetween(0, slice.content.size, "\n\n"), slice };
      },
    } as unknown as EditorView;
    return { view, events };
  }

  it("Android: copy writes values only — no ClipboardItem write (no text-flavor poisoning)", async () => {
    setUA(ANDROID_UA);
    // ClipboardItem AVAILABLE: the platform gate itself must skip the rich
    // write (the poisoning is a WebView quirk, not a missing API — a stubbed
    // undefined ClipboardItem would silently test the generic fallback).
    (globalThis as unknown as Record<string, unknown>).ClipboardItem = FakeClipboardItem;
    const write = vi.fn(async () => {});
    const written: string[] = [];
    stubClipboard({
      write,
      writeText: async (t: string) => {
        written.push(t);
      },
    });
    const { view } = clipboardView(cellSelectionState());
    expect(copyTableSelection(view)).toBe(true);
    await flush();
    expect(write).not.toHaveBeenCalled();
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("A00");
    expect(written[0]).toContain("A11");
    expect(written[0]).not.toContain("<table");
  });

  it("desktop: copy writes the rich flavor (html + text)", async () => {
    setUA(DESKTOP_UA);
    (globalThis as unknown as Record<string, unknown>).ClipboardItem = FakeClipboardItem;
    const written: Array<FakeClipboardItem> = [];
    stubClipboard({
      write: async (items: Array<FakeClipboardItem>) => {
        written.push(...items);
      },
      writeText: async () => {
        throw new Error("writeText must not run on the rich path");
      },
    });
    const { view } = clipboardView(cellSelectionState());
    expect(copyTableSelection(view)).toBe(true);
    await flush();
    expect(written).toHaveLength(1);
    expect(Object.keys(written[0].data).sort()).toEqual(["text/html", "text/plain"]);
    expect(await written[0].data["text/html"].text()).toContain("<table");
  });

  it("rich write denied falls back to writeText (values still land)", async () => {
    setUA(DESKTOP_UA);
    (globalThis as unknown as Record<string, unknown>).ClipboardItem = FakeClipboardItem;
    const written: string[] = [];
    stubClipboard({
      write: async () => {
        throw new Error("denied");
      },
      writeText: async (t: string) => {
        written.push(t);
      },
    });
    const { view } = clipboardView(cellSelectionState());
    expect(copyTableSelection(view)).toBe(true);
    await flush();
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("A00");
  });

  it("Android: readText over a cell selection rebuilds a 1x1 TSV grid", async () => {
    setUA(ANDROID_UA);
    stubClipboard({
      read: async () => {
        throw new DOMException("Read permission denied", "NotAllowedError");
      },
      readText: async () => "A00 A01",
    });
    const { view, events } = clipboardView(cellSelectionState());
    await expect(pasteFromSystemClipboard(view)).resolves.toBe(true);
    expect(events).toHaveLength(1);
    const dt = events[0]?.clipboardData;
    // the single value tiles over the rectangle as a 1x1 grid (the same
    // shape the rich flavor produces on desktop)
    expect(dt?.getData("text/html")).toContain("<table");
    expect(dt?.getData("text/html")).toContain("A00 A01");
    expect(dt?.getData("text/plain")).toBe("A00 A01");
  });

  it("Android: plain single-line text at a caret stays native (no TSV rebuild)", async () => {
    setUA(ANDROID_UA);
    stubClipboard({
      read: async () => {
        throw new DOMException("Read permission denied", "NotAllowedError");
      },
      readText: async () => "just a sentence",
    });
    const doc = twoTablesDoc();
    const p = cellPositions(doc, 0)[0];
    const state = stateWithSelection(doc, TextSelection.create(doc, p + 2));
    const { view, events } = clipboardView(state);
    await expect(pasteFromSystemClipboard(view)).resolves.toBe(true);
    expect(events).toHaveLength(1);
    const dt = events[0]?.clipboardData;
    // caret + single-line text: inline insertion, no grid rebuild
    expect(dt?.getData("text/html")).toBe("");
    expect(dt?.getData("text/plain")).toBe("just a sentence");
  });

  it("Android: tabbed text at a caret rebuilds the grid (external TSV paste)", async () => {
    setUA(ANDROID_UA);
    stubClipboard({
      read: async () => {
        throw new DOMException("Read permission denied", "NotAllowedError");
      },
      readText: async () => "X0\tX1\nY0\tY1",
    });
    const doc = twoTablesDoc();
    const p = cellPositions(doc, 0)[0];
    const state = stateWithSelection(doc, TextSelection.create(doc, p + 2));
    const { view, events } = clipboardView(state);
    await expect(pasteFromSystemClipboard(view)).resolves.toBe(true);
    const dt = events[0]?.clipboardData;
    expect(dt?.getData("text/html")).toContain("<table");
    expect(dt?.getData("text/html")).toContain("X0");
    expect(dt?.getData("text/plain")).toBe("X0\tX1\nY0\tY1");
  });

  it("Android: newline-only text at a caret rebuilds a column grid (device-tested expectation)", async () => {
    // owner's device round: copying a whole column and pasting at a caret
    // inserts a new column — the same Excel semantics desktop html delivers
    setUA(ANDROID_UA);
    stubClipboard({
      read: async () => {
        throw new DOMException("Read permission denied", "NotAllowedError");
      },
      readText: async () => "A\nB\nC",
    });
    const doc = twoTablesDoc();
    const p = cellPositions(doc, 0)[0];
    const state = stateWithSelection(doc, TextSelection.create(doc, p + 2));
    const { view, events } = clipboardView(state);
    await expect(pasteFromSystemClipboard(view)).resolves.toBe(true);
    const dt = events[0]?.clipboardData;
    expect(dt?.getData("text/html")).toContain("<table");
    expect(dt?.getData("text/html")).toContain(">A<");
    expect(dt?.getData("text/plain")).toBe("A\nB\nC");
  });

  it("desktop: html flavor wins when present (TSV stays the text flavor)", async () => {
    setUA(DESKTOP_UA);
    stubClipboard({
      read: async () => [
        {
          types: ["text/html", "text/plain"],
          getType: async (type: string) =>
            new Blob([type === "text/html" ? "<table><tr><td><p>HTML</p></td></tr></table>" : "A\tB"], { type }),
        },
      ],
    });
    const doc = twoTablesDoc();
    const p = cellPositions(doc, 0)[0];
    const state = stateWithSelection(doc, TextSelection.create(doc, p + 2));
    const { view, events } = clipboardView(state);
    await expect(pasteFromSystemClipboard(view)).resolves.toBe(true);
    const dt = events[0]?.clipboardData;
    expect(dt?.getData("text/html")).toContain("HTML");
    expect(dt?.getData("text/html")).not.toContain("<td><p>A</p>");
    expect(dt?.getData("text/plain")).toBe("A\tB");
  });

  it("desktop: paste reads the rich flavor when read() is allowed", async () => {
    setUA(DESKTOP_UA);
    stubClipboard({
      read: async () => [
        {
          types: ["text/html", "text/plain"],
          getType: async (type: string) =>
            new Blob([type === "text/html" ? "<table><tr><td>A00</td></tr></table>" : "A00"], { type }),
        },
      ],
    });
    const { view, events } = clipboardView(cellSelectionState());
    await expect(pasteFromSystemClipboard(view)).resolves.toBe(true);
    expect(events).toHaveLength(1);
    const dt = events[0]?.clipboardData;
    expect(dt?.getData("text/html")).toContain("<table");
    expect(dt?.getData("text/plain")).toBe("A00");
  });
});

describe("TSV text flavor (toolbar copy / paste rebuild)", () => {
  const flush = () => new Promise((r) => window.setTimeout(r, 0));
  const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/152.0.0.0 Mobile";
  const DESKTOP_UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36";
  const realUA = navigator.userAgent;
  const realClipboard = (navigator as unknown as { clipboard: unknown }).clipboard;
  const realClipboardItem = (globalThis as unknown as Record<string, unknown>).ClipboardItem;

  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", { value: realUA, configurable: true });
    (navigator as unknown as { clipboard: unknown }).clipboard = realClipboard;
    (globalThis as unknown as Record<string, unknown>).ClipboardItem = realClipboardItem;
  });

  function stubClipboard(stub: Record<string, unknown>): void {
    (navigator as unknown as { clipboard: unknown }).clipboard = stub;
  }

  function setUA(ua: string): void {
    Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
  }

  class FakeClipboardItem {
    data: Record<string, Blob>;
    constructor(data: Record<string, Blob>) {
      this.data = data;
    }
  }

  function viewFor(state: EditorState): EditorView {
    const serializer = DOMSerializer.fromSchema(state.schema);
    return {
      state,
      dispatch: () => {},
      focus: () => {},
      dom: createDiv(),
      serializeForClipboard: (slice: Slice) => {
        const el = createDiv();
        el.appendChild(serializer.serializeFragment(slice.content));
        return { dom: el, text: slice.content.textBetween(0, slice.content.size, "\n\n"), slice };
      },
    } as unknown as EditorView;
  }

  it("toolbar copy writes the TSV text flavor (Excel-compatible)", async () => {
    setUA(DESKTOP_UA);
    (globalThis as unknown as Record<string, unknown>).ClipboardItem = FakeClipboardItem;
    let tsv = "";
    let html = "";
    stubClipboard({
      write: async (items: Array<FakeClipboardItem>) => {
        html = await items[0]?.data["text/html"].text();
        tsv = await items[0]?.data["text/plain"].text();
      },
      writeText: async () => {
        throw new Error("writeText must not run on the rich path");
      },
    });
    const doc = twoTablesDoc();
    const state = stateWithSelection(doc, rectSelection(doc, 0));
    expect(copyTableSelection(viewFor(state))).toBe(true);
    await flush();
    expect(tsv).toBe("A00\tA01\nA10\tA11");
    expect(html).toContain("<table");
  });

  it("Android copy (values-only) writes the same TSV", async () => {
    setUA(ANDROID_UA);
    (globalThis as unknown as Record<string, unknown>).ClipboardItem = FakeClipboardItem;
    const written: string[] = [];
    stubClipboard({
      write: async () => {
        throw new Error("rich write must not run on Android");
      },
      writeText: async (t: string) => {
        written.push(t);
      },
    });
    const doc = twoTablesDoc();
    const state = stateWithSelection(doc, rectSelection(doc, 0));
    expect(copyTableSelection(viewFor(state))).toBe(true);
    await flush();
    expect(written[0]).toBe("A00\tA01\nA10\tA11");
    expect(written[0]).not.toContain("<table");
  });

  it("multi-paragraph cells flatten to one line in TSV", async () => {
    setUA(DESKTOP_UA);
    (globalThis as unknown as Record<string, unknown>).ClipboardItem = FakeClipboardItem;
    let tsv = "";
    stubClipboard({
      write: async (items: Array<FakeClipboardItem>) => {
        tsv = await items[0]?.data["text/plain"].text();
      },
      writeText: async () => {
        throw new Error("writeText must not run on the rich path");
      },
    });
    const multi = schema.nodes.tableCell.create(null, [
      schema.nodes.paragraph.create(null, [schema.text("a")]),
      schema.nodes.paragraph.create(null, [schema.text("b")]),
    ]);
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(null, [schema.text("T")]),
      table([row([multi])]),
    ]);
    const [p] = cellPositions(doc, 0);
    const state = stateWithSelection(doc, new CellSelection(doc.resolve(p)));
    expect(copyTableSelection(viewFor(state))).toBe(true);
    await flush();
    expect(tsv).toBe("a b");
    expect(tsv).not.toContain("\n");
  });

  it("tsvToHtml round-trips through the paste parser as a cell grid", () => {
    // the real paste pipeline: PM parses the event's html into a slice,
    // handleCellPaste extracts the grid from it
    const html = tsvToHtml("A00\tA01\nA10\tA11");
    const dom = new window.DOMParser().parseFromString(html, "text/html");
    const slice = DOMParser.fromSchema(schema).parseSlice(dom.body.firstChild as Element);
    const grid = extractCellGrid(slice);
    expect(grid).not.toBeNull();
    expect(grid?.map((cells) => cells.map((c) => c.textContent))).toEqual([
      ["A00", "A01"],
      ["A10", "A11"],
    ]);
  });

  it("tsvToHtml strips CRLF runs of trailing blank rows (spreadsheet selections)", () => {
    // Excel/Sheets often cover one row past the data: "…\r\n\r\n" — the
    // trailing empty row must not become part of the grid
    const gridFrom = (text: string): unknown => {
      const dom = new window.DOMParser().parseFromString(tsvToHtml(text), "text/html");
      const slice = DOMParser.fromSchema(schema).parseSlice(dom.body.firstChild as Element);
      return extractCellGrid(slice)?.map((cells) => cells.map((c) => c.textContent));
    };
    expect(gridFrom("A\tB\r\nC\tD\r\n\r\n")).toEqual([["A", "B"], ["C", "D"]]);
    expect(gridFrom("A\nB\n")).toEqual([["A"], ["B"]]);
    expect(gridFrom("A")).toEqual([["A"]]);
  });

  it("tsvToHtml keeps empty cells of a row", () => {
    const dom = new window.DOMParser().parseFromString(tsvToHtml("a\t"), "text/html");
    const slice = DOMParser.fromSchema(schema).parseSlice(dom.body.firstChild as Element);
    expect(extractCellGrid(slice)?.map((cells) => cells.map((c) => c.textContent))).toEqual([["a", ""]]);
  });

  it("tsvToHtml escapes html-significant characters", () => {
    const html = tsvToHtml('a<b & "c"');
    expect(html).toContain("a&lt;b &amp; &quot;c&quot;");
    expect(html).not.toContain("<b");
  });
});

describe("keyboard cell copy / paste interception (device-testing round)", () => {
  function cellRectState(): EditorState {
    const doc = twoTablesDoc();
    return stateWithSelection(doc, rectSelection(doc, 0));
  }

  function clipboardDomView(state: EditorState): { view: EditorView; events: ClipboardEvent[] } {
    const events: ClipboardEvent[] = [];
    const dom = createDiv();
    dom.addEventListener("paste", (e) => events.push(e as ClipboardEvent));
    const serializer = DOMSerializer.fromSchema(state.schema);
    const view = {
      state,
      dispatch: () => {},
      focus: () => {},
      dom,
      serializeForClipboard: (slice: Slice) => {
        const el = createDiv();
        el.appendChild(serializer.serializeFragment(slice.content));
        return { dom: el, text: slice.content.textBetween(0, slice.content.size, "\n\n"), slice };
      },
    } as unknown as EditorView;
    return { view, events };
  }

  function pluginProps(state: EditorState) {
    const plugin = state.plugins.find((p) => p.spec.props?.handleDOMEvents);
    const props = plugin?.spec.props?.handleDOMEvents as
      | Record<string, (view: EditorView, event: ClipboardEvent) => boolean>
      | undefined;
    expect(props).toBeDefined();
    return props!;
  }

  it("keyboard copy on a cell selection writes html + TSV into the event", () => {
    const doc = twoTablesDoc();
    const state = stateWithSelection(doc, rectSelection(doc, 0));
    const { view } = clipboardDomView(state);
    const dt = new DataTransfer();
    const ev = new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true });
    expect(pluginProps(state).copy(view, ev)).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(dt.getData("text/html")).toContain("<table");
    expect(dt.getData("text/plain")).toBe("A00\tA01\nA10\tA11");
  });

  it("keyboard copy of a 1x1 TextoCellSelection produces a non-empty payload", () => {
    // the motivating case: TextoCellSelection collapses its endpoints, so
    // PM's stock copy handler reads the selection as empty and writes
    // nothing at all — the handler must carry the cell instead
    const doc = twoTablesDoc();
    const [p1] = cellPositions(doc, 0);
    const state = stateWithSelection(doc, new TextoCellSelection(doc.resolve(p1)));
    const { view } = clipboardDomView(state);
    const dt = new DataTransfer();
    const ev = new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true });
    expect(pluginProps(state).copy(view, ev)).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    // an open 1x1 slice serializes as a bare td fragment (PM's stock shape
    // for open slices) — non-empty and carrying the cell's value
    expect(dt.getData("text/html")).toContain("A00");
    expect(dt.getData("text/html")).toContain("<td");
    expect(dt.getData("text/plain")).toBe("A00");
  });

  it("keyboard copy outside a cell selection stays native", () => {
    const doc = twoTablesDoc();
    const p = cellPositions(doc, 0)[0];
    const state = stateWithSelection(doc, TextSelection.create(doc, p + 2));
    const { view } = clipboardDomView(state);
    const ev = new ClipboardEvent("copy", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    expect(pluginProps(state).copy(view, ev)).toBe(false);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("paste with table html carrying data-id is replayed without the attrs", () => {
    const state = cellRectState();
    const { view, events } = clipboardDomView(state);
    const dt = new DataTransfer();
    dt.setData("text/html", '<table data-pm-slice="1 1 -2 []"><tbody><tr data-id="abc12345xy"><td data-id="def67890uv" colspan="1" rowspan="1"><p data-id="ghi13579zx">A00</p></td><td colspan="1" rowspan="1"><p>A01</p></td></tr></tbody></table>');
    dt.setData("text/plain", "A00\n\nA01");
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    expect(pluginProps(state).paste(view, ev)).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    // the clean replay carries the same flavors, data-id stripped
    expect(events).toHaveLength(1);
    const replayed = events[0]?.clipboardData;
    expect(replayed?.getData("text/html")).toContain("<table");
    expect(replayed?.getData("text/html")).not.toContain("data-id");
    expect(replayed?.getData("text/plain")).toBe("A00\n\nA01");
  });

  it("paste without data-id (or non-table html) passes through untouched", () => {
    const state = cellRectState();
    const { view, events } = clipboardDomView(state);
    const dt = new DataTransfer();
    dt.setData("text/html", '<table><tbody><tr><td><p>A00</p></td></tr></tbody></table>');
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    expect(pluginProps(state).paste(view, ev)).toBe(false);
    expect(events).toHaveLength(0);

    const dt2 = new DataTransfer();
    dt2.setData("text/html", '<p data-id="abc12345xy">not a table</p>');
    const ev2 = new ClipboardEvent("paste", { clipboardData: dt2, bubbles: true, cancelable: true });
    expect(pluginProps(state).paste(view, ev2)).toBe(false);
    expect(events).toHaveLength(0);
  });
});
