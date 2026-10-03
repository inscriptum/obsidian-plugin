import { describe, it, expect } from "vitest";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";
import type { JSONContent } from "../../core/@types";
import { buildSchema } from "../../../../tests/helpers/buildSchema";
import { createTable } from "./helpers/createTable";
import {
  bordersFromStyle,
  bordersToStyle,
  type CellBorders,
} from "./helpers/borders";

const schema = buildSchema();

const PEN = { style: "solid", width: "1.5pt", color: "#b3a3f7" } as const;
const PEN_2 = { style: "dashed", width: "3pt", color: "#4ade80" } as const;

function editorWithTable(rows: number, cols: number) {
  const table: ProseMirrorNode = createTable(schema, rows, cols, false);
  const editor = new Editor({
    element: createDiv(),
    content: {
      type: "noteDoc",
      // noteDoc content spec is "noteTitle (block | …)+" — the title first.
      content: [
        { type: "noteTitle", content: [] },
        table.toJSON() as JSONContent,
      ],
    } as unknown as JSONContent,
    extensions: getExtensions(),
  });
  return editor;
}

function tablePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === "table") {
      pos = p;
      return false;
    }
    return true;
  });
  if (pos < 0) throw new Error("table not found in test doc");
  return pos;
}

/** Doc positions of all cells, row-major. */
function cells(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      positions.push(pos);
    }
    return true;
  });
  return positions;
}

function bordersAt(editor: Editor, pos: number): CellBorders | null {
  return (editor.state.doc.nodeAt(pos)?.attrs.borders ?? null) as
    | CellBorders
    | null;
}

function cellSelection(editor: Editor, anchor: number, head: number) {
  editor.commands.setCellSelection({ anchorCell: anchor, headCell: head });
}

function cellDomStyle(editor: Editor, pos: number): string {
  const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
  return dom?.getAttribute("style") ?? "";
}

describe("table borders commands", () => {
  it("toggleCellsBorders applies the pen to the current cell (caret)", () => {
    const editor = editorWithTable(2, 2);
    const [c1] = cells(editor);
    editor.commands.setTextSelection(c1 + 1);

    expect(
      editor.commands.toggleCellsBorders({ ...PEN }, ["top"]),
    ).toBe(true);

    expect(bordersAt(editor, c1)).toEqual({
      top: { style: "solid", width: "1.5pt", color: "#b3a3f7" },
    });
    // The cell's DOM carries the inline border (beats the default grid).
    // (jsdom re-serializes hex colors to rgb() — assert format, not color.)
    expect(cellDomStyle(editor, c1)).toContain("border-top: 1.5pt solid");
    expect(cellDomStyle(editor, c1)).toContain("!important");
    // Neighbours untouched.
    expect(bordersAt(editor, cells(editor)[1])).toBe(null);

    editor.destroy();
  });

  it("toggleCellsBorders removes the side when it already matches", () => {
    const editor = editorWithTable(2, 2);
    const [c1] = cells(editor);
    editor.commands.setTextSelection(c1 + 1);
    editor.commands.toggleCellsBorders({ ...PEN }, ["top"]);
    editor.commands.toggleCellsBorders({ ...PEN }, ["top"]);

    expect(bordersAt(editor, c1)).toBe(null);

    editor.destroy();
  });

  it("toggleCellsBorders over a selection applies unless every side matches", () => {
    const editor = editorWithTable(2, 2);
    const [c1, c2] = cells(editor);
    // Only the first cell has the pen so far.
    editor.commands.setTextSelection(c1 + 1);
    editor.commands.toggleCellsBorders({ ...PEN }, ["left"]);

    cellSelection(editor, c1, c2);
    // Not all cells match → the pen is applied to both.
    editor.commands.toggleCellsBorders({ ...PEN }, ["left"]);
    expect(bordersAt(editor, c1)).toEqual({
      left: { style: "solid", width: "1.5pt", color: "#b3a3f7" },
    });
    expect(bordersAt(editor, c2)).toEqual({
      left: { style: "solid", width: "1.5pt", color: "#b3a3f7" },
    });
    // Now every cell matches → toggle removes.
    editor.commands.toggleCellsBorders({ ...PEN }, ["left"]);
    expect(bordersAt(editor, c1)).toBe(null);
    expect(bordersAt(editor, c2)).toBe(null);

    editor.destroy();
  });

  it("setBordersBox frames the WHOLE table regardless of the selection", () => {
    const editor = editorWithTable(3, 3);
    const cs = cells(editor);
    // A small selection in the middle — the frame is still the table's.
    cellSelection(editor, cs[4], cs[4]);

    expect(editor.commands.setBordersBox({ ...PEN })).toBe(true);

    // Corners get two sides…
    expect(Object.keys(bordersAt(editor, cs[0]) ?? {}).sort()).toEqual([
      "left",
      "top",
    ]);
    expect(Object.keys(bordersAt(editor, cs[2]) ?? {}).sort()).toEqual([
      "right",
      "top",
    ]);
    expect(Object.keys(bordersAt(editor, cs[6]) ?? {}).sort()).toEqual([
      "bottom",
      "left",
    ]);
    expect(Object.keys(bordersAt(editor, cs[8]) ?? {}).sort()).toEqual([
      "bottom",
      "right",
    ]);
    // …edge middles one…
    expect(Object.keys(bordersAt(editor, cs[1]) ?? {})).toEqual(["top"]);
    expect(Object.keys(bordersAt(editor, cs[5]) ?? {})).toEqual(["right"]);
    // …the center none.
    expect(bordersAt(editor, cs[4])).toBe(null);

    editor.destroy();
  });

  it("setBordersBox from a bare caret frames the whole table", () => {
    const editor = editorWithTable(2, 2);
    const cs = cells(editor);
    editor.commands.setTextSelection(cs[3] + 1); // last cell

    editor.commands.setBordersBox({ ...PEN });

    expect(Object.keys(bordersAt(editor, cs[0]) ?? {}).sort()).toEqual([
      "left",
      "top",
    ]);
    expect(Object.keys(bordersAt(editor, cs[3]) ?? {}).sort()).toEqual([
      "bottom",
      "right",
    ]);

    editor.destroy();
  });

  it("applyTableBorders applies the pen to every side of every cell", () => {
    const editor = editorWithTable(2, 2);
    const cs = cells(editor);
    editor.commands.setTextSelection(cs[0] + 1); // bare caret

    editor.commands.applyTableBorders({ ...PEN });

    for (const pos of cs) {
      expect(Object.keys(bordersAt(editor, pos) ?? {}).sort()).toEqual([
        "bottom",
        "left",
        "right",
        "top",
      ]);
    }

    editor.destroy();
  });

  it("applyTableBorders lifts the table-level borderless attr", () => {
    const editor = editorWithTable(2, 2);
    const cs = cells(editor);
    editor.commands.setTextSelection(cs[0] + 1);
    editor.commands.removeTableBorders();
    expect(editor.state.doc.nodeAt(tablePos(editor))?.attrs.borders).toBe(
      "none",
    );

    editor.commands.applyTableBorders({ ...PEN });

    for (const pos of cs) {
      expect(bordersAt(editor, pos)).not.toBe(null);
    }
    // The suppression attr is lifted: the table is explicitly bordered and
    // cells inserted later should show the default grid.
    expect(editor.state.doc.nodeAt(tablePos(editor))?.attrs.borders).toBe(
      null,
    );

    editor.destroy();
  });

  it("setBordersInside(horizontal) draws inner lines of the selection", () => {
    const editor = editorWithTable(2, 2);
    const cs = cells(editor);
    cellSelection(editor, cs[0], cs[3]); // 2×2

    editor.commands.setBordersInside({ ...PEN }, "horizontal");

    // Top row draws its bottom side; bottom row nothing.
    expect(Object.keys(bordersAt(editor, cs[0]) ?? {})).toEqual(["bottom"]);
    expect(Object.keys(bordersAt(editor, cs[1]) ?? {})).toEqual(["bottom"]);
    expect(bordersAt(editor, cs[2])).toBe(null);
    expect(bordersAt(editor, cs[3])).toBe(null);

    editor.destroy();
  });

  it("setBordersInside(vertical) draws inner vertical lines", () => {
    const editor = editorWithTable(2, 2);
    const cs = cells(editor);
    cellSelection(editor, cs[0], cs[3]); // 2×2

    editor.commands.setBordersInside({ ...PEN }, "vertical");

    // Left column draws its right side.
    expect(Object.keys(bordersAt(editor, cs[0]) ?? {})).toEqual(["right"]);
    expect(Object.keys(bordersAt(editor, cs[2]) ?? {})).toEqual(["right"]);
    expect(bordersAt(editor, cs[1])).toBe(null);
    expect(bordersAt(editor, cs[3])).toBe(null);

    editor.destroy();
  });

  it("setBordersInside from a bare caret covers the whole table", () => {
    const editor = editorWithTable(2, 2);
    const cs = cells(editor);
    editor.commands.setTextSelection(cs[3] + 1); // caret in the last cell

    editor.commands.setBordersInside({ ...PEN }, "horizontal");

    expect(Object.keys(bordersAt(editor, cs[0]) ?? {})).toEqual(["bottom"]);
    expect(Object.keys(bordersAt(editor, cs[1]) ?? {})).toEqual(["bottom"]);
    expect(bordersAt(editor, cs[2])).toBe(null);
    expect(bordersAt(editor, cs[3])).toBe(null);

    editor.destroy();
  });

  it("removeTableBorders targets the whole table and marks it borderless", () => {
    const editor = editorWithTable(2, 2);
    const cs = cells(editor);
    editor.commands.setTextSelection(cs[0] + 1);
    editor.commands.toggleCellsBorders({ ...PEN }, ["top"]); // some custom border

    editor.commands.removeTableBorders();

    expect(editor.state.doc.nodeAt(tablePos(editor))?.attrs.borders).toBe(
      "none",
    );
    for (const pos of cs) {
      expect(bordersAt(editor, pos)).toBe(null);
    }

    editor.destroy();
  });

  it("borders survive getJSON (persistence round-trip)", () => {
    const editor = editorWithTable(2, 2);
    const [c1] = cells(editor);
    editor.commands.setTextSelection(c1 + 1);
    editor.commands.toggleCellsBorders({ ...PEN_2 }, ["bottom"]);

    const json = editor.getJSON();
    const tableJson = json.content?.find((n) => n.type === "table");
    const cellJson = tableJson?.content?.[0]?.content?.[0];
    expect(cellJson?.attrs?.borders).toEqual({
      bottom: { style: "dashed", width: "3pt", color: "#4ade80" },
    });

    editor.destroy();
  });

  it("a merged cell spanning the rect edge gets the outer side once", () => {
    const editor = editorWithTable(2, 2);
    const cs = cells(editor);
    // Merge the two cells of the first row (colspan 2).
    editor.commands.setTextSelection(cs[0] + 1);
    cellSelection(editor, cs[0], cs[1]);
    editor.commands.mergeCells();
    const mergedPos = cells(editor)[0]; // merged cell + last row's cells
    cellSelection(editor, mergedPos, cells(editor).at(-1)!);

    editor.commands.setBordersBox({ ...PEN });

    const borders = bordersAt(editor, mergedPos) ?? {};
    expect(borders.top).toEqual({
      style: "solid",
      width: "1.5pt",
      color: "#b3a3f7",
    });
    expect(borders.left).toBeDefined();
    expect(borders.right).toBeDefined();

    editor.destroy();
  });
});

describe("borders style helpers", () => {
  it("bordersToStyle renders per-side declarations with !important", () => {
    expect(
      bordersToStyle({
        top: { style: "solid", width: "2.25pt", color: null },
        bottom: { style: "none" },
      }),
    ).toBe(
      "border-top: 2.25pt solid var(--inscriptum-table-border) !important; border-bottom: none !important",
    );
    expect(bordersToStyle(null)).toBe("");
    expect(bordersToStyle({})).toBe("");
  });

  it("bordersFromStyle reads longhand inline styles back", () => {
    // Built via DOMParser: assigning el.style.* directly is lint-blocked in
    // this repo, and the parser route exercises the same CSSOM read path.
    const el = new DOMParser().parseFromString(
      '<div style="border-top: 2px solid rgb(179, 163, 247); border-bottom-style: none"></div>',
      "text/html",
    ).body.querySelector("div") as HTMLElement;

    expect(bordersFromStyle(el)).toEqual({
      top: { style: "solid", width: "2px", color: "#B3A3F7" },
      bottom: { style: "none" },
    });
  });

  it("bordersFromStyle returns null for elements without border styles", () => {
    const el = createEl("td");
    expect(bordersFromStyle(el)).toBe(null);
  });
});
