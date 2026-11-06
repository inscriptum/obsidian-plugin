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
  it("marks the renderHTML wrapper with data-ignore-swipe", () => {
    // The mobile shell reads edge drags as drawer swipes; a resize grab on a
    // full-width table's edge column starts there (issue
    // table-resize-edge-swipe). The wrapper is the handle's container.
    const editor = editorWithTable();
    const wrapper = editor.view.dom.querySelector(".table-wrapper");
    expect(wrapper?.getAttribute("data-ignore-swipe")).toBe("true");
  });

  it("marks the TableView (node view) wrapper with data-ignore-swipe", () => {
    const table = createTable(schema, 2, 2, false);
    const view = new TableView(table, 25);
    expect(view.dom.getAttribute("data-ignore-swipe")).toBe("true");
  });
});
