import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import { buildSchema } from "../../../tests/helpers/buildSchema";
import { createTable } from "../../texto/extensions/table/helpers/createTable";
import {
  bgHexToAttr,
  getTableMenuState,
  BORDER_COLORS,
  isHexColor,
  TABLE_BG_RGBA,
} from "./tableMenuState";

const schema = buildSchema();

/** Positions of all table cells. */
function cellPositions(doc: Node): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      positions.push(pos);
    }
    return true;
  });
  return positions;
}

function caretState(doc: Node, atCell: number) {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, atCell + 1),
  });
}

describe("getTableMenuState", () => {
  it("reports not-in-table for a plain paragraph", () => {
    const doc = schema.nodes.paragraph.create(null, schema.text("hello"));
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    expect(getTableMenuState(state)).toEqual({
      inTable: false,
      multiCell: false,
      mergedCell: false,
      headerRow: false,
      bg: null,
      textColor: null,
      bordersNone: false,
    });
  });

  it("detects caret inside a table cell", () => {
    const table = createTable(schema, 2, 2, false);
    const [p1] = cellPositions(table);
    const state = caretState(table, p1);
    const s = getTableMenuState(state);
    expect(s.inTable).toBe(true);
    expect(s.multiCell).toBe(false);
    expect(s.mergedCell).toBe(false);
  });

  it("detects multi-cell selection (merge enabled)", () => {
    const table = createTable(schema, 2, 2, false);
    const [p1, , , p4] = cellPositions(table);
    const state = EditorState.create({
      doc: table,
      selection: CellSelection.create(table, p1, p4),
    });
    const s = getTableMenuState(state);
    expect(s.inTable).toBe(true);
    expect(s.multiCell).toBe(true);
  });

  it("detects merged cell (split enabled)", () => {
    const table = createTable(schema, 2, 2, false);
    const [p1] = cellPositions(table);
    const mergedDoc = EditorState.create({ doc: table }).tr.setNodeMarkup(
      p1,
      null,
      { colspan: 2, rowspan: 1 },
    ).doc;
    const state = caretState(mergedDoc, p1);
    const s = getTableMenuState(state);
    expect(s.mergedCell).toBe(true);
  });

  it("detects header row only when created with header", () => {
    const withHeader = createTable(schema, 2, 2, true);
    const [p1] = cellPositions(withHeader);
    expect(getTableMenuState(caretState(withHeader, p1)).headerRow).toBe(true);

    const withoutHeader = createTable(schema, 2, 2, false);
    const [p2] = cellPositions(withoutHeader);
    expect(getTableMenuState(caretState(withoutHeader, p2)).headerRow).toBe(
      false,
    );
  });

  it("reads backgroundColor and dataColor attrs", () => {
    const table = createTable(schema, 2, 2, false);
    const [p1] = cellPositions(table);
    const doc = EditorState.create({ doc: table }).tr.setNodeMarkup(p1, null, {
      backgroundColor: "rgba(74,222,128,.14)",
      dataColor: "#4ade80",
    }).doc;
    const s = getTableMenuState(caretState(doc, p1));
    expect(s.bg).toBe("rgba(74,222,128,.14)");
    expect(s.textColor).toBe("#4ade80");
  });

  it("reports bordersNone when the table attr is set", () => {
    const table = createTable(schema, 2, 2, false);
    const [p1] = cellPositions(table);
    // The standalone doc IS the table node — rebuild it with borders: "none".
    const borderless = table.type.create(
      { ...table.attrs, borders: "none" },
      table.content,
    );
    expect(getTableMenuState(caretState(borderless, p1)).bordersNone).toBe(
      true,
    );

    expect(getTableMenuState(caretState(table, p1)).bordersNone).toBe(false);
  });
});

describe("TABLE_BG_RGBA / bgHexToAttr", () => {
  it("maps palette hex to the design semi-transparent fill", () => {
    expect(bgHexToAttr("#4ade80")).toBe("rgba(74, 222, 128, .14)");
    expect(bgHexToAttr(null)).toBe(null);
  });

  it("keeps unknown values as-is", () => {
    expect(bgHexToAttr("custom-color")).toBe("custom-color");
  });

  it("has an entry for every fill", () => {
    expect(Object.keys(TABLE_BG_RGBA)).toHaveLength(4);
  });
});

describe("BORDER_COLORS / isHexColor", () => {
  it("palette has auto + 11 swatches, unique hex values", () => {
    expect(BORDER_COLORS).toHaveLength(12);
    const hexes = BORDER_COLORS.filter((c) => c.color).map((c) => c.color);
    expect(new Set(hexes).size).toBe(hexes.length);
    expect(BORDER_COLORS[0].color).toBe(null);
  });

  it("isHexColor accepts #rgb and #rrggbb only", () => {
    expect(isHexColor("#4ade80")).toBe(true);
    expect(isHexColor("#F71")).toBe(true);
    expect(isHexColor("4ade80")).toBe(false);
    expect(isHexColor("#4ade8")).toBe(false);
    expect(isHexColor("rgb(74, 222, 128)")).toBe(false);
    expect(isHexColor("")).toBe(false);
  });
});
