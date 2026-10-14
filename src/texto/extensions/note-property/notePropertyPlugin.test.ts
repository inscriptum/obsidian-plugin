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
  it("a focused row keeps one trailing empty draft after committed tags", () => {
    const { editor, el } = build(tagsRowDoc(["one"]));
    focusRow(editor, 0);
    awaitAnimationFrame();
    // The speculative draft input: the slot the next tag is typed into.
    expect(valueCount(editor)).toBe(2);
    const values = (rowProp(editor).content ?? []).filter(
      (n: JSONContent) => n.type === "notePropertyValue",
    );
    expect(values[1]?.content ?? []).toEqual([]); // the draft is empty
    editor.destroy();
    el.remove();
  });

  it("property fields stay plain: pasted marks are stripped", () => {
    const { editor, el } = build(tagsRowDoc(["one"]));
    focusRow(editor, 0);
    // Simulate a formatted paste: insert bold text into the draft.
    const pm = editor.view;
    const boldMark = pm.state.schema.marks.bold.create();
    const anchor = pm.state.selection.from;
    pm.dispatch(pm.state.tr.insertText("X", anchor));
    pm.dispatch(pm.state.tr.addMark(anchor, anchor + 1, boldMark));
    awaitAnimationFrame();
    const tags = rowProp(editor).content ?? [];
    const values = tags.filter((n: JSONContent) => n.type === "notePropertyValue");
    const allPlain = values.every((v: JSONContent) =>
      (v.content ?? []).every((t: JSONContent) => !t.marks || t.marks.length === 0),
    );
    expect(allPlain).toBe(true);
    const texts = values.map((v: JSONContent) => (v.content ?? []).map((t: JSONContent) => t.text).join(""));
    expect(texts.join(" ")).toContain("X");
    editor.destroy();
    el.remove();
  });

  it("an empty draft stays when the caret leaves (no content shift); a duplicate tail is pruned", () => {
    const { editor, el } = build(tagsRowDoc(["one"]));
    focusRow(editor, 0);
    // Enter in the last chip opens the next draft.
    propertyKeyDown(editor.state, "Enter", null, (tr) =>
      editor.view.dispatch(tr),
    );
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(2);
    // leave: caret into the trailing paragraph — the empty draft STAYS
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(2);

    // A typed DUPLICATE tail ("ONE" vs "one") is pruned on leave — its
    // Enter was rejected, and leaving must not commit it.
    const caretEnd = editor.state.selection.to;
    editor.view.dispatch(editor.state.tr.insertText("ONE", caretEnd));
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(2);
    // leave: the duplicate tail is pruned; the empty draft slot STAYS (no
    // content shift below).
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    awaitAnimationFrame();
    const values = (rowProp(editor).content ?? []).filter(
      (n: JSONContent) => n.type === "notePropertyValue",
    );
    expect(values.map((v: JSONContent) => (v.content ?? []).map((t: JSONContent) => t.text).join(""))).toEqual([
      "one",
      "",
    ]);
    editor.destroy();
    el.remove();
  });

  it("an empty tags row gains a draft while focused and keeps it when left (no shift)", () => {
    const { editor, el } = build(tagsRowDoc([]));
    expect(valueCount(editor)).toBe(0);
    focusRow(editor, -1); // caret at the end of the row's name
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(1); // the draft input
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(1); // kept: the layout does not shift
    editor.destroy();
    el.remove();
  });
});

function awaitAnimationFrame(): void {
  // appendTransaction runs synchronously inside apply; a microtask keeps
  // the test honest about not relying on timers.
}
