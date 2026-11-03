import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import { afterEach, describe, expect, it } from "vitest";

import { buildSchema } from "../../../../../tests/helpers/buildSchema";

import {
  beginCrossCellDrag,
  endCrossCellDrag,
  isCrossCellDragActive,
} from "./cellDragFreeze";
import { createTable } from "./createTable";
import { handleCellSelection } from "./handleCellSelection";
import { handleTouchStart } from "./handleTouchStart";

const schema = buildSchema();

function tableDoc(rows = 2, cols = 2): ProseMirrorNode {
  return createTable(schema, rows, cols, false);
}

function cellPositions(doc: ProseMirrorNode): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      positions.push(pos);
    }
    return true;
  });
  return positions;
}

function filterOf(isMobileView: boolean) {
  const plugin = handleCellSelection(isMobileView);
  const filter = plugin.spec.filterTransaction;
  expect(filter).toBeDefined();
  return filter!;
}

describe("crossCellDrag state", () => {
  afterEach(() => {
    endCrossCellDrag();
  });

  it("flags the gesture on and off", () => {
    expect(isCrossCellDragActive()).toBe(false);
    beginCrossCellDrag();
    expect(isCrossCellDragActive()).toBe(true);
    endCrossCellDrag();
    expect(isCrossCellDragActive()).toBe(false);
  });
});

describe("handleCellSelection filterTransaction during a cross-cell drag", () => {
  afterEach(() => {
    endCrossCellDrag();
  });

  function stateWithCaret() {
    const doc = tableDoc();
    const plugin = handleCellSelection(false);
    return EditorState.create({
      doc,
      selection: TextSelection.near(doc.resolve(cellPositions(doc)[0] + 1)),
      plugins: [plugin],
    });
  }

  it("blocks a TextSelection reset while the drag is cross-cell", () => {
    const state = stateWithCaret();
    const filter = filterOf(false);
    beginCrossCellDrag();

    // The browser-committed text range syncing back — the reported reset.
    const reset = state.tr.setSelection(
      TextSelection.near(state.doc.resolve(cellPositions(state.doc)[1] + 1)),
    );
    expect(filter(reset, state)).toBe(false);
  });

  it("lets the cell-rectangle dispatches through", () => {
    const state = stateWithCaret();
    const filter = filterOf(false);
    beginCrossCellDrag();

    const [p1, , , p4] = cellPositions(state.doc);
    const rectangle = state.tr.setSelection(CellSelection.create(state.doc, p1, p4));
    expect(filter(rectangle, state)).toBe(true);
  });

  it("lets transactions that do not touch the selection through", () => {
    const state = stateWithCaret();
    const filter = filterOf(false);
    beginCrossCellDrag();

    // Meta-only transaction (e.g. prosemirror-tables' drag-state cleanup).
    expect(filter(state.tr.setMeta("test", 1), state)).toBe(true);
  });

  it("outside the gesture the reset is not blocked by this guard", () => {
    const state = stateWithCaret();
    const filter = filterOf(false);

    const reset = state.tr.setSelection(
      TextSelection.near(state.doc.resolve(cellPositions(state.doc)[1] + 1)),
    );
    // The latch branch (not armed here) and the TextoCellSelection state
    // check decide — the caret state lets the reset through.
    expect(filter(reset, state)).toBe(true);
  });

  it("mobile view never filters (the gesture model differs)", () => {
    const doc = tableDoc();
    const filter = filterOf(true);
    const state = EditorState.create({
      doc,
      selection: TextSelection.near(doc.resolve(cellPositions(doc)[0] + 1)),
      plugins: [],
    });
    beginCrossCellDrag();

    const reset = state.tr.setSelection(
      TextSelection.near(doc.resolve(cellPositions(doc)[1] + 1)),
    );
    expect(filter(reset, state)).toBe(true);
  });
});

describe("handleTouchStart table-wide prevention (mobile residual gap)", () => {
  function touch(target: HTMLElement): { prevented: boolean } {
    let prevented = false;
    const event = {
      target,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as TouchEvent;
    // The prevention path never touches the view.
    handleTouchStart({} as never, event);
    return { prevented };
  }

  function buildDom() {
    const wrapper = createDiv("table-wrapper");
    const table = createEl("table");
    const tr = createEl("tr");
    const td = createEl("td");
    const p = createEl("p");
    td.appendChild(p);
    tr.appendChild(td);
    table.appendChild(tr);
    wrapper.appendChild(table);
    const outside = createEl("p");
    document.body.append(wrapper, outside);
    return { wrapper, table, tr, td, p, outside };
  }

  it("prevents a touch on a cell (owner of the gesture)", () => {
    const dom = buildDom();
    expect(touch(dom.td).prevented).toBe(true);
  });

  it("prevents a touch on the gap between cells (a row)", () => {
    const dom = buildDom();
    expect(touch(dom.tr).prevented).toBe(true);
  });

  it("prevents a touch on the table border", () => {
    const dom = buildDom();
    expect(touch(dom.table).prevented).toBe(true);
  });

  it("keeps native scrolling for the wrapper padding", () => {
    const dom = buildDom();
    expect(touch(dom.wrapper).prevented).toBe(false);
  });

  it("keeps text selection outside tables", () => {
    const dom = buildDom();
    expect(touch(dom.outside).prevented).toBe(false);
  });
});
