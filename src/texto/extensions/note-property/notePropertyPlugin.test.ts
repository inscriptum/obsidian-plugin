import { describe, expect, it } from "vitest";
import { Editor } from "../../core";
import { getExtensions } from "../../getExtensions";
import { propertyKeyDown } from "./notePropertyModel";
import type { JSONContent } from "../../core/@types";

/**
 * The List-row draft lifecycle (plugin appendTransaction): a focused List
 * row keeps one trailing empty value as its draft input; the draft is
 * pruned when the caret leaves the row, so a row with no committed tags
 * serializes zero values.
 */

function tagsRowDoc(values: string[]): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
      {
        type: "noteProperty",
        attrs: { type: "list" },
        content: [
          { type: "notePropertyName", content: [{ type: "text", text: "tags" }] },
          ...values.map((value) => ({
            type: "notePropertyValue",
            content: value ? [{ type: "text", text: value }] : [],
          })),
        ],
      },
      { type: "paragraph" },
    ],
  };
}

function build(content: JSONContent): { editor: Editor; el: HTMLElement } {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    content,
    extensions: getExtensions({}, { isMobileView: false, profile: "title" }),
  });
  return { editor, el };
}

function rowProp(editor: Editor): JSONContent {
  const content = editor.getJSON().content ?? [];
  return content[1] ?? { type: "noteDoc" };
}

function valueCount(editor: Editor): number {
  return (rowProp(editor).content ?? []).filter(
    (n: JSONContent) => n.type === "notePropertyValue",
  ).length;
}

function committedChips(editor: Editor): string[] {
  return (rowProp(editor).content ?? [])
    .filter((n: JSONContent) => n.type === "notePropertyValue")
    .map((n: JSONContent) => (n.content ?? []).map((t: JSONContent) => t.text).join(""));
}

/** Caret to the end of the value at `valueIndex` (or into the row's name
 *  when -1). */
function focusRow(editor: Editor, valueIndex: number): void {
  const doc = editor.state.doc;
  let pos: number | null = null;
  doc.forEach((node, off) => {
    if (node.type.name !== "noteProperty" || pos != null) return;
    let p = off + 1;
    let vi = -1;
    node.forEach((child) => {
      if (child.type.name === "notePropertyName") {
        if (valueIndex === -1) pos = p + 1 + child.content.size;
      } else {
        vi += 1;
        if (vi === valueIndex) pos = p + 1 + child.content.size;
      }
      p += child.nodeSize;
    });
  });
  editor.commands.setTextSelection(pos!);
}

describe("List-row draft lifecycle (appendTransaction)", () => {
  it("a focused row with committed tags does NOT grow a speculative draft (Enter opens it)", () => {
    const { editor, el } = build(tagsRowDoc(["one"]));
    focusRow(editor, 0);
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(1);
    editor.destroy();
    el.remove();
  });

  it("the draft is pruned when the caret leaves the row", () => {
    const { editor, el } = build(tagsRowDoc(["one"]));
    focusRow(editor, 0);
    // Enter in the last chip commits nothing yet but opens the next draft.
    propertyKeyDown(editor.state, "Enter", null, (tr) =>
      editor.view.dispatch(tr),
    );
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(2);
    // leave: caret into the trailing paragraph
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(1);
    editor.destroy();
    el.remove();
  });

  it("an empty tags row gains a draft while focused and serializes zero values when left", () => {
    const { editor, el } = build(tagsRowDoc([]));
    expect(valueCount(editor)).toBe(0);
    focusRow(editor, -1); // caret at the end of the row's name
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(1); // the draft input
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(0); // pruned: zero tags serialized
    editor.destroy();
    el.remove();
  });
});

function awaitAnimationFrame(): void {
  // appendTransaction runs synchronously inside apply; a microtask keeps
  // the test honest about not relying on timers.
}
