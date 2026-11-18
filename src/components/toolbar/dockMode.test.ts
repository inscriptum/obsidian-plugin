import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import { buildSchema } from "../../../tests/helpers/buildSchema";
import { createTable } from "../../texto/extensions/table/helpers/createTable";
import { computeDockMode } from "./dockMode";

const schema = buildSchema();

/** computeDockMode reads editor.state — a bare state satisfies it. */
function mode(state: EditorState) {
  return computeDockMode({ state } as never);
}

function doc(node: Node): EditorState {
  // The note profile's top node is not "doc" — a bare node is a valid state
  // doc (same as tableMenuState.test.ts building states straight off a table).
  return EditorState.create({ doc: node });
}

describe("computeDockMode", () => {
  it("returns 'none' for an empty caret in a plain paragraph", () => {
    const st = doc(schema.nodes.paragraph.create(null, schema.text("hello")));
    const caret = st.apply(st.tr.setSelection(TextSelection.create(st.doc, 2)));
    expect(mode(caret)).toBe("none");
  });

  it("returns 'text' for a non-empty text selection", () => {
    const st = doc(schema.nodes.paragraph.create(null, schema.text("hello")));
    // The paragraph IS the state doc — its text spans 0..5.
    const sel = st.apply(
      st.tr.setSelection(TextSelection.create(st.doc, 0, 5)),
    );
    expect(mode(sel)).toBe("text");
  });

  it("returns 'table' for a caret inside a table cell", () => {
    const table = createTable(schema, 2, 2, false);
    const st = doc(table);
    // First cell's paragraph: 1 (doc open) + 1 (table) + 1 (row) + 1 (cell)
    // lands before the cell's paragraph; the caret sits inside it.
    const caret = st.apply(st.tr.setSelection(TextSelection.create(st.doc, 4)));
    expect(mode(caret)).toBe("table");
  });

  it("returns 'table' for a CellSelection across cells", () => {
    const table = createTable(schema, 2, 2, false);
    const cells: number[] = [];
    table.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
      return true;
    });
    const st = EditorState.create({
      doc: table,
      selection: CellSelection.create(table, cells[0], cells[3]),
    });
    expect(mode(st)).toBe("table");
  });

  it("returns 'text' for a text selection inside a cell (marks apply)", () => {
    const table = createTable(schema, 1, 1, false);
    const cells: number[] = [];
    table.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
      return true;
    });
    const cellStart = cells[0] + 1; // inside the cell's paragraph ("ab")
    const sel = EditorState.create({
      doc: table,
      selection: TextSelection.create(table, cellStart, cellStart + 2),
    });
    expect(mode(sel)).toBe("text");
  });
});
