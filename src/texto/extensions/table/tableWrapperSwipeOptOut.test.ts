import { DOMSerializer, Fragment } from "prosemirror-model";
import { describe, expect, it } from "vitest";

import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";
import type { JSONContent } from "../../core/@types";
import { buildSchema } from "../../../../tests/helpers/buildSchema";
import { createTable } from "./helpers/createTable";
import { TableView } from "./tableView";

const schema = buildSchema();

function editorWithTable() {
  const table = createTable(schema, 2, 2, false);
  return new Editor({
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
}

describe("table wrapper drawer-swipe opt-out", () => {
  it("renders the editor node-view wrapper with data-ignore-swipe", () => {
    // With columnResizing active the table renders through the TableView
    // node view — the path the live editor actually uses.
    const editor = editorWithTable();
    try {
      const wrapper = editor.view.dom.querySelector(".table-wrapper");
      expect(wrapper?.getAttribute("data-ignore-swipe")).toBe("true");
    } finally {
      // paste rules hold window listeners until the editor is destroyed
      editor.destroy();
    }
  });

  it("serializes the renderHTML wrapper with data-ignore-swipe", () => {
    // The toDOM path (read-only renders, serialization) must carry the
    // attribute too — a columnResizing-less render skips the node view.
    const table = createTable(schema, 2, 2, false);
    const target = createDiv();
    DOMSerializer.fromSchema(schema).serializeFragment(Fragment.from(table), {}, target);
    expect(target.querySelector(".table-wrapper")?.getAttribute("data-ignore-swipe")).toBe("true");
  });

  it("marks the TableView wrapper with data-ignore-swipe", () => {
    const table = createTable(schema, 2, 2, false);
    const view = new TableView(table, 25);
    expect(view.dom.getAttribute("data-ignore-swipe")).toBe("true");
  });
});
