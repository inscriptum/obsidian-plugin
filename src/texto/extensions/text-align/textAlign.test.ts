import { describe, expect, it } from "vitest";
import { generateHTML } from "../../core/helpers/generateHTML";
import { Editor } from "../../core";
import { getExtensions } from "../../getExtensions";
import { getExportExtensions } from "../../../export/extensions";
import type { JSONContent } from "../../core/@types";

function buildEditor(content: JSONContent): Editor {
  const el = createDiv();
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    content,
    onError: (err) => {
      throw err instanceof Error ? err : new Error(String(err));
    },
    extensions: getExtensions({}, { isMobileView: false, profile: "note" }),
    autofocus: false,
  });
  if (editor.view == null) {
    throw new Error("editor did not initialize");
  }
  return editor;
}

function docWith(...blocks: JSONContent[]): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Align" }] },
      ...blocks,
    ],
  };
}

const p = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const h = (level: number, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

/** Position of the start of the i-th top-level block of the document. */
function blockStart(editor: Editor, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) {
    pos += editor.state.doc.child(i).nodeSize;
  }
  return pos;
}

describe("setTextAlign command", () => {
  it("centers the paragraph under the caret", () => {
    const editor = buildEditor(docWith(p("hello"), p("world")));
    const start = blockStart(editor, 1);
    editor.commands.setTextSelection(start + 2);
    expect(editor.commands.setTextAlign("center")).toBe(true);
    const para = editor.state.doc.child(1);
    expect(para.attrs.align).toBe("center");
    // DOM projection: inline style on the block element.
    const dom = editor.view.domAtPos(start + 1);
    const el = dom.node as HTMLElement;
    expect(el.style?.textAlign).toBe("center");
    editor.destroy();
  });

  it("is one undo step and toggling the active value returns to left", () => {
    const editor = buildEditor(docWith(p("hello")));
    editor.commands.setTextSelection(blockStart(editor, 1) + 2);
    editor.commands.setTextAlign("center");
    // Toggle the active alignment → left, stored as no attribute at all.
    expect(editor.commands.setTextAlign("center")).toBe(true);
    expect(editor.state.doc.child(1).attrs.align ?? null).toBeNull();
    expect(editor.getJSON().content?.[1].attrs?.align ?? null).toBeNull();
    // One undo step covers the centering: undo → back to the untouched doc.
    editor.commands.setTextAlign("center");
    editor.commands.undo();
    expect(editor.state.doc.child(1).attrs.align ?? null).toBeNull();
    editor.destroy();
  });

  it("left always clears the attribute (even from right)", () => {
    const editor = buildEditor(docWith(p("hello")));
    editor.commands.setTextSelection(blockStart(editor, 1) + 2);
    editor.commands.setTextAlign("right");
    expect(editor.state.doc.child(1).attrs.align).toBe("right");
    editor.commands.setTextAlign("left");
    expect(editor.state.doc.child(1).attrs.align ?? null).toBeNull();
    editor.destroy();
  });

  it("applies to every block spanned by the selection in one transaction", () => {
    const editor = buildEditor(docWith(p("one"), h(1, "Two"), p("three")));
    const from = blockStart(editor, 1) + 2;
    const to = blockStart(editor, 3) + 4;
    editor.commands.setTextSelection({ from, to });
    expect(editor.commands.setTextAlign("right")).toBe(true);
    expect(editor.state.doc.child(1).attrs.align).toBe("right");
    expect(editor.state.doc.child(2).attrs.align).toBe("right");
    expect(editor.state.doc.child(3).attrs.align).toBe("right");
    editor.commands.undo();
    expect(editor.state.doc.child(1).attrs.align ?? null).toBeNull();
    expect(editor.state.doc.child(2).attrs.align ?? null).toBeNull();
    expect(editor.state.doc.child(3).attrs.align ?? null).toBeNull();
    editor.destroy();
  });

  it("aligns the paragraph inside a list item and a task item", () => {
    const editor = buildEditor(
      docWith({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "li" }] }],
          },
        ],
      }),
    );
    // Caret inside the list item's paragraph: the title block's size,
    // then bulletList/listItem/paragraph openings, one char into the text.
    editor.commands.setTextSelection(blockStart(editor, 1) + 4);
    expect(editor.commands.setTextAlign("center")).toBe(true);
    const list = editor.state.doc.child(1);
    expect(list.type.name).toBe("bulletList");
    const item = list.child(0);
    expect(item.child(0).attrs.align).toBe("center");
    editor.destroy();
  });

  it("aligns the paragraph inside a task item (PR #22 CR-22-04)", () => {
    const editor = buildEditor(
      docWith({
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "todo" }] },
            ],
          },
        ],
      }),
    );
    // Caret inside the task item's paragraph: the title block's size, then
    // taskList/taskItem/paragraph openings, one char into the text.
    editor.commands.setTextSelection(blockStart(editor, 1) + 4);
    expect(editor.commands.setTextAlign("right")).toBe(true);
    const list = editor.state.doc.child(1);
    expect(list.type.name).toBe("taskList");
    const item = list.child(0);
    expect(item.type.name).toBe("taskItem");
    expect(item.child(0).attrs.align).toBe("right");
    // The taskItem checkbox state is untouched by the alignment change.
    expect(item.attrs.checked).toBe(false);
    editor.destroy();
  });

  it("aligns the paragraph inside a table cell", () => {
    const editor = buildEditor(
      docWith({
        type: "table",
        attrs: { data: { rowsCount: 1, colsCount: 1 } },
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 1, rowspan: 1 },
                content: [p("cell")],
              },
            ],
          },
        ],
      }),
    );
    // Caret inside the cell paragraph: the title block's size, then
    // table/row/cell/paragraph openings, one char into the text.
    editor.commands.setTextSelection(blockStart(editor, 1) + 5);
    expect(editor.commands.setTextAlign("center")).toBe(true);
    const cell = editor.state.doc.child(1).child(0).child(0);
    expect(cell.child(0).attrs.align).toBe("center");
    editor.destroy();
  });

  it("round-trips attrs.align through JSON (schema-declared)", () => {
    const editor = buildEditor(docWith(p("hello"), h(1, "Head")));
    editor.commands.setTextSelection(blockStart(editor, 1) + 2);
    editor.commands.setTextAlign("center");
    editor.commands.setTextSelection(blockStart(editor, 2) + 2);
    editor.commands.setTextAlign("right");
    const json = editor.getJSON();
    expect(json.content?.[1].attrs?.align).toBe("center");
    expect(json.content?.[2].attrs?.align).toBe("right");
    const restored = buildEditor(json);
    expect(restored.state.doc.child(1).attrs.align).toBe("center");
    expect(restored.state.doc.child(2).attrs.align).toBe("right");
    // Export schema (attrs-only) keeps the attr through generateJSON too.
    restored.destroy();
    editor.destroy();
  });

  it("a mixed selection applies the picked alignment; a uniform one toggles", () => {
    const editor = buildEditor(docWith(p("one"), h(1, "Two")));
    editor.commands.setTextSelection(blockStart(editor, 1) + 2);
    editor.commands.setTextAlign("center");
    // Mixed selection: paragraph(center) + heading(none) — center APPLIES.
    editor.commands.setTextSelection({
      from: blockStart(editor, 1) + 1,
      to: blockStart(editor, 2) + 2,
    });
    expect(editor.commands.setTextAlign("center")).toBe(true);
    expect(editor.state.doc.child(1).attrs.align).toBe("center");
    expect(editor.state.doc.child(2).attrs.align).toBe("center");
    // Now uniform — the same click toggles back to left.
    expect(editor.commands.setTextAlign("center")).toBe(true);
    expect(editor.state.doc.child(1).attrs.align ?? null).toBeNull();
    expect(editor.state.doc.child(2).attrs.align ?? null).toBeNull();
    editor.destroy();
  });

  it("the export schema renders the alignment as an inline style", () => {
    const editor = buildEditor(docWith(p("hello"), h(1, "Head")));
    editor.commands.setTextSelection(blockStart(editor, 1) + 2);
    editor.commands.setTextAlign("center");
    editor.commands.setTextSelection(blockStart(editor, 2) + 2);
    editor.commands.setTextAlign("right");
    const html = generateHTML(editor.getJSON(), getExportExtensions());
    expect(html).toContain('style="text-align: center;"');
    expect(html).toContain('style="text-align: right;"');
    editor.destroy();
  });

  it("pre-feature documents open unchanged (no align attr)", () => {
    const editor = buildEditor(docWith(p("old doc")));
    expect(editor.state.doc.child(1).attrs.align ?? null).toBeNull();
    const json = editor.getJSON();
    expect(json.content?.[1].attrs?.align ?? null).toBeNull();
    editor.destroy();
  });
});
