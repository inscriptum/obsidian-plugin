import type { Transaction } from "prosemirror-state";
import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";

import { buildSchema } from "../../../../tests/helpers/buildSchema";

import { TableMap } from "prosemirror-tables";

import { addCommands } from "./commands";

const schema = buildSchema();

const cell = (t: string) => ({ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const head = (t: string) => ({ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: 'text', text: t }] }] });
const row = (cells: ReturnType<typeof cell>[]) => ({ type: "tableRow", content: cells });
const table = (rows: ReturnType<typeof row>[]) => ({
  type: "table",
  attrs: { data: { rowsCount: rows.length, colsCount: rows[0]?.content.length ?? 0 } },
  content: rows,
});
const makeDoc = (tables: ReturnType<typeof table>[]) => ({
  type: "noteDoc",
  content: [{ type: "noteTitle", content: [{ type: 'text', text: "T" }] }, ...tables],
});

function cellPositions(node: ReturnType<typeof schema.nodeFromJSON>, tableIndex = 0): number[] {
  const positions: number[] = [];
  let seen = -1;
  node.descendants((n, p) => {
    if (n.type.name === "table") {
      seen += 1;
      return seen === tableIndex;
    }
    if (seen === tableIndex && (n.type.name === "tableCell" || n.type.name === "tableHeader")) {
      positions.push(p);
    }
    return true;
  });
  return positions;
}

function cellTexts(state: EditorState, tableIndex = 0): string[] {
  const out: string[] = [];
  let seen = -1;
  state.doc.descendants((n) => {
    if (n.type.name === "table") {
      seen += 1;
      return seen === tableIndex;
    }
    if (seen === tableIndex && (n.type.name === "tableCell" || n.type.name === "tableHeader")) {
      out.push(n.textContent);
    }
    return true;
  });
  return out;
}

/** Run a table command against a caret placed inside the cell at
 *  `caretCell` (index within the table's cells). */
function runCommand(
  document: ReturnType<typeof makeDoc>,
  name: "duplicateRow" | "duplicateColumn",
  caretCell: number,
): { ok: boolean; next: EditorState; positions: number[] } {
  const node = schema.nodeFromJSON(document);
  const positions = cellPositions(node);
  const withCaret = EditorState.create({
    doc: node,
    selection: TextSelection.create(node, positions[caretCell] + 1),
  });
  const commands = addCommands.bind({} as never)();
  const dispatched: Transaction[] = [];
  // The addCommands methods are curried: (options) => Command, so the bare
  // call materializes the Command that then takes { state, dispatch }.
  const command = (commands[name] as unknown as (opts?: never) => (p: {
    state: EditorState;
    dispatch: (t: Transaction) => void;
  }) => boolean)(undefined);
  const ok = command({
    state: withCaret,
    dispatch: (tr: Transaction) => {
      dispatched.push(tr);
    },
  });
  expect(dispatched).toHaveLength(ok ? 1 : 0);
  return {
    ok,
    next: dispatched.length ? withCaret.apply(dispatched[0]) : withCaret,
    positions,
  };
}

describe("duplicateRow", () => {
  it("clones the caret row right below it", () => {
    const { ok, next } = runCommand(
      makeDoc([table([row([cell("r0a"), cell("r0b")]), row([cell("r1a"), cell("r1b")])])]),
      "duplicateRow",
      0,
    );
    expect(ok).toBe(true);
    expect(cellTexts(next)).toEqual(["r0a", "r0b", "r0a", "r0b", "r1a", "r1b"]);
  });

  it("clones a rowspan cell unmerged into the copy", () => {
    // Col 0 merged across rows 0-1; duplicating row 0 clones "M" as a
    // standalone cell, the original merge keeps spanning rows 0-1.
    const merged = {
      type: "tableCell",
      attrs: { rowspan: 2 },
      content: [{ type: "paragraph", content: [{ type: "text", text: "M" }] }],
    };
    const { next } = runCommand(
      makeDoc([table([
        row([merged, cell("c01"), cell("c02")]),
        row([cell("c11"), cell("c12")]),
      ])]),
      "duplicateRow",
      1,
    );
    const texts = cellTexts(next);
    // The merge crossing the insertion line extends over the copy row; the
    // clone row fills only the free columns (the covered column has no cell
    // in it — the extended M spans it).
    expect(texts).toEqual(["M", "c01", "c02", "c01", "c02", "c11", "c12"]);
    // Table shape survived: the map still resolves a consistent 3-column
    // grid (no extra columns, no phantom rows).
    let tableNodeRef: import("prosemirror-model").Node | undefined;
    next.doc.descendants((n) => {
      if (tableNodeRef == null && n.type.name === "table") tableNodeRef = n;
      return tableNodeRef == null;
    });
    const map = TableMap.get(tableNodeRef as import("prosemirror-model").Node);
    expect(map.width).toBe(3);
    expect(map.height).toBe(3);
  });
});

describe("duplicateColumn", () => {
  it("clones the caret column right of itself, keeping row types", () => {
    const { next } = runCommand(
      makeDoc([table([
        row([head("h0"), head("h1")]),
        row([cell("a0"), cell("a1")]),
        row([cell("b0"), cell("b1")]),
      ])]),
      "duplicateColumn",
      0,
    );
    expect(cellTexts(next)).toEqual(["h0", "h0", "h1", "a0", "a0", "a1", "b0", "b0", "b1"]);
    // The clone of the header column is a header cell.
    const positions = cellPositions(next.doc);
    const cloneCell = next.doc.nodeAt(positions[1]);
    expect(cloneCell?.type.name).toBe("tableHeader");
  });
});
