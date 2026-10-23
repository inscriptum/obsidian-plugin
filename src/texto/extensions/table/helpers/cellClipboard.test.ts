import type { Node as ProseMirrorNode } from "prosemirror-model";
import { DOMSerializer, Fragment, Slice } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { CellSelection } from "prosemirror-tables";
import { describe, expect, it } from "vitest";

import { buildSchema } from "../../../../../tests/helpers/buildSchema";

import { cellClipboardPlugin, copyTableSelection, cutCellSelection, cutTableSelection, extractCellGrid } from "./cellClipboard";

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
