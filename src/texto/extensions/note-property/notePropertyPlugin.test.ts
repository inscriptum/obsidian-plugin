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

  it("a caret entering a zero-value row's locked name lands in the created draft", () => {
    const { editor, el } = build(tagsRowDoc([]));
    focusRow(editor, -1); // the locked name of a row without values
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(1); // the draft created in the same pass
    // The caret never rests in the locked name — it sits in the draft.
    expect(editor.state.selection.$head.node(2)?.type.name).toBe(
      "notePropertyValue",
    );
    editor.destroy();
    el.remove();
  });

  it("a click on a zero-value List row creates the draft and places the caret", () => {
    const { editor, el } = build(tagsRowDoc([]));
    const rowEl = el.querySelector(".note-property");
    expect(rowEl).toBeTruthy();
    rowEl!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    awaitAnimationFrame();
    expect(valueCount(editor)).toBe(1); // the click created the draft input
    expect(editor.state.selection.$head.node(2)?.type.name).toBe(
      "notePropertyValue",
    );
    editor.destroy();
    el.remove();
  });

  it("typing a duplicate preset name reverts to the row's own previous text", () => {
    // The revert maps row i onto the previous document's i-th PROPERTY
    // row (the leading title must not shift the index into reading the
    // wrong row's name).
    const { editor, el } = build({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        {
          type: "noteProperty",
          attrs: { type: "text" },
          content: [
            { type: "notePropertyName", content: [{ type: "text", text: "status" }] },
            { type: "notePropertyValue" },
          ],
        },
        {
          type: "noteProperty",
          attrs: { type: "text" },
          content: [
            { type: "notePropertyName" },
            { type: "notePropertyValue" },
          ],
        },
        { type: "paragraph" },
      ],
    });
    // Caret at the end of the second row's (empty) name.
    const doc = editor.state.doc;
    let pos: number | null = null;
    let seen = 0;
    doc.forEach((node, off) => {
      if (node.type.name !== "noteProperty" || pos != null) return;
      seen += 1;
      if (seen === 2) {
        const name = node.firstChild!;
        pos = off + 1 + 1 + name.content.size;
      }
    });
    editor.view.dispatch(
      editor.view.state.tr.insertText("status", pos!, pos!),
    );
    awaitAnimationFrame();
    const row = (editor.getJSON().content ?? [])[2];
    expect(row.content?.[0]?.content?.[0]?.text).toBeUndefined(); // reverted to empty
    editor.destroy();
    el.remove();
  });
});

function pressKey(editor: Editor, key: string): void {
  (editor.view.dom as HTMLElement).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

describe("Cover boundary (title + properties sealed)", () => {
  function titleDoc(): JSONContent {
    return {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        {
          type: "noteProperty",
          attrs: { type: "text" },
          content: [
            { type: "notePropertyName", content: [{ type: "text", text: "status" }] },
            { type: "notePropertyValue", content: [{ type: "text", text: "draft" }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    };
  }

  it("Enter in the title opens the first property instead of splitting a block", () => {
    const { editor, el } = build(titleDoc());
    editor.commands.setTextSelection(3); // inside the title text
    const before = editor.state.doc.childCount;
    pressKey(editor, "Enter");
    awaitAnimationFrame();
    expect(editor.state.doc.childCount).toBe(before); // the cover stays sealed
    expect(editor.state.selection.$head.node(1)?.type.name).toBe("noteProperty");
    editor.destroy();
    el.remove();
  });

  it("Enter in the title creates the first property when none exists", () => {
    const { editor, el } = build({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    });
    editor.commands.setTextSelection(3);
    pressKey(editor, "Enter");
    awaitAnimationFrame();
    const types = editor.state.doc.content.content.map((n) => n.type.name);
    expect(types).toEqual(["noteTitle", "noteProperty", "paragraph"]);
    expect(editor.state.selection.$head.node(2)?.type.name).toBe("notePropertyName");
    editor.destroy();
    el.remove();
  });

  it("Backspace at the top of the first content block does not join into the cover", () => {
    const { editor, el } = build(titleDoc());
    // The paragraph's first content position (after title + row).
    const titleSize = editor.state.doc.content.child(0).nodeSize;
    const rowSize = editor.state.doc.content.child(1).nodeSize;
    editor.commands.setTextSelection(titleSize + rowSize + 1);
    const jsonBefore = JSON.stringify(editor.getJSON());
    pressKey(editor, "Backspace");
    awaitAnimationFrame();
    expect(JSON.stringify(editor.getJSON())).toBe(jsonBefore);
    editor.destroy();
    el.remove();
  });

  it("Delete at the title's end does not merge the first row into it", () => {
    const { editor, el } = build(titleDoc());
    editor.commands.setTextSelection(editor.state.doc.content.child(0).content.size + 1);
    const jsonBefore = JSON.stringify(editor.getJSON());
    pressKey(editor, "Delete");
    awaitAnimationFrame();
    expect(JSON.stringify(editor.getJSON())).toBe(jsonBefore);
    editor.destroy();
    el.remove();
  });

  it("Delete at the last value's end does not merge the content into the row", () => {
    const { editor, el } = build(titleDoc());
    // The end of the row's value content ("draft").
    const titleSize = editor.state.doc.content.child(0).nodeSize;
    const row = editor.state.doc.content.child(1);
    editor.commands.setTextSelection(titleSize + 1 + row.firstChild!.nodeSize + 1 + row.lastChild!.content.size);
    const jsonBefore = JSON.stringify(editor.getJSON());
    pressKey(editor, "Delete");
    awaitAnimationFrame();
    expect(JSON.stringify(editor.getJSON())).toBe(jsonBefore);
    editor.destroy();
    el.remove();
  });
});

describe("Tag validity (filled, non-duplicate values only)", () => {
  it("an erased chip is pruned instead of becoming an empty pill", () => {
    const { editor, el } = build(tagsRowDoc(["one", "two"]));
    // Erase the whole "one" chip: select its text and delete it.
    const row = editor.state.doc.content.child(1);
    const nameSize = row.firstChild!.nodeSize;
    const oneFrom = titlePad() + 1 + nameSize + 1;
    editor.view.dispatch(editor.view.state.tr.delete(oneFrom, oneFrom + 3));
    awaitAnimationFrame();
    expect(committedChips(editor).filter((t) => t.length > 0)).toEqual(["two"]);
    editor.destroy();
    el.remove();
  });

  it("a duplicate draft word abandoned mid-row is pruned", () => {
    const { editor, el } = build(tagsRowDoc(["one"]));
    focusRow(editor, 0);
    awaitAnimationFrame();
    // Enter opens the draft; type a duplicate word there.
    propertyKeyDown(editor.state, "Enter", null, (tr) => editor.view.dispatch(tr));
    editor.view.dispatch(editor.view.state.tr.insertText("ONE"));
    awaitAnimationFrame();
    // The word being typed grows its own fresh draft after it.
    expect(valueCount(editor)).toBe(3);
    // The caret moves to the committed chip: the abandoned duplicate goes.
    focusRow(editor, 0);
    awaitAnimationFrame();
    expect(committedChips(editor).filter((t) => t.length > 0)).toEqual(["one"]);
    editor.destroy();
    el.remove();
  });

  it("the word being typed is not pruned while the caret holds it", () => {
    const { editor, el } = build(tagsRowDoc(["one"]));
    focusRow(editor, 0);
    awaitAnimationFrame();
    propertyKeyDown(editor.state, "Enter", null, (tr) => editor.view.dispatch(tr));
    editor.view.dispatch(editor.view.state.tr.insertText("ONE"));
    awaitAnimationFrame();
    // The caret still holds the duplicate word — pruning waits.
    expect(committedChips(editor).filter((t) => t.length > 0)).toEqual([
      "one",
      "ONE",
    ]);
    editor.destroy();
    el.remove();
  });
});

/** The leading noteTitle node's size in the tag-row test docs. */
function titlePad(): number {
  return 1 + "Cover".length + 1;
}

function awaitAnimationFrame(): void {
  // appendTransaction runs synchronously inside apply; a microtask keeps
  // the test honest about not relying on timers.
}

describe("PR review fixes (round 17)", () => {
  it("Enter with a selection inside a Text value deletes it instead of splitting the field", () => {
    const { editor, el } = build({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        {
          type: "noteProperty",
          attrs: { type: "text" },
          content: [
            { type: "notePropertyName", content: [{ type: "text", text: "status" }] },
            { type: "notePropertyValue", content: [{ type: "text", text: "alpha beta" }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    });
    // Select "beta" inside the value and press Enter.
    const rowNode = editor.state.doc.content.child(1);
    const valueFrom = editor.state.doc.content.child(0).nodeSize + 1 + rowNode.firstChild!.nodeSize + 1;
    editor.commands.setTextSelection({ from: valueFrom + 6, to: valueFrom + 10 });
    expect(editor.state.selection.empty).toBe(false);
    pressKey(editor, "Enter");
    awaitAnimationFrame();
    const row = (editor.getJSON().content ?? [])[1];
    const values = row.content?.filter((n) => n.type === "notePropertyValue") ?? [];
    expect(values).toHaveLength(1); // no split
    expect(values[0]?.content?.map((t) => t.text).join("")).toBe("alpha ");
    // the caret took the Text row's Enter semantics: the next block below
    const types = editor.state.doc.content.content.map((n) => n.type.name);
    expect(types).toEqual(["noteTitle", "noteProperty", "paragraph"]);
    editor.destroy();
    el.remove();
  });

  it("the autocomplete popup navigates with arrows and dismisses with Escape", () => {
    const { editor, el } = build({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        {
          type: "noteProperty",
          attrs: { type: "text" },
          content: [
            { type: "notePropertyName" },
            { type: "notePropertyValue" },
          ],
        },
        { type: "paragraph" },
      ],
    });
    // Caret into the empty name: suggestions open with all four presets.
    editor.commands.setTextSelection(editor.state.doc.content.child(0).nodeSize + 2);
    awaitAnimationFrame();
    const selected = () => {
      const plugin = editor.view.state.plugins.find((p) => p.getState(editor.view.state) && "dismissed" in (p.getState(editor.view.state) ?? {}));
      return plugin?.getState(editor.view.state) as { selected: number; dismissed: boolean };
    };
    expect(selected().selected).toBe(0);
    pressKey(editor, "ArrowDown");
    awaitAnimationFrame();
    expect(selected().selected).toBe(1);
    pressKey(editor, "ArrowUp");
    awaitAnimationFrame();
    expect(selected().selected).toBe(0);
    pressKey(editor, "Escape");
    awaitAnimationFrame();
    expect(selected().dismissed).toBe(true);
    editor.destroy();
    el.remove();
  });

  it("the grip menu deletes the row with click-time bounds (no stale range)", () => {
    const { editor, el } = build({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        {
          type: "noteProperty",
          attrs: { type: "text" },
          content: [
            { type: "notePropertyName", content: [{ type: "text", text: "status" }] },
            { type: "notePropertyValue", content: [{ type: "text", text: "a long value text" }] },
          ],
        },
        {
          type: "noteProperty",
          attrs: { type: "text" },
          content: [
            { type: "notePropertyName", content: [{ type: "text", text: "version" }] },
            { type: "notePropertyValue", content: [{ type: "text", text: "1.0" }] },
          ],
        },
        { type: "paragraph" },
      ],
    });
    // Shorten the first row AFTER the widgets were built, then open its
    // menu and delete through it.
    const rowNode = editor.state.doc.content.child(1);
    const valueFrom = editor.state.doc.content.child(0).nodeSize + 1 + rowNode.firstChild!.nodeSize + 1;
    editor.view.dispatch(editor.view.state.tr.delete(valueFrom + 1, valueFrom + 15));
    awaitAnimationFrame();
    const grip = el.querySelector(".note-property-grip")!;
    grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    grip.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    awaitAnimationFrame();
    const menu = document.body.querySelector(".note-property-menu");
    expect(menu).toBeTruthy();
    const deleteItem = menu!.querySelector(".note-property-menu__item.is-danger") as HTMLElement;
    deleteItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    awaitAnimationFrame();
    const types = editor.state.doc.content.content.map((n) => n.type.name);
    expect(types).toEqual(["noteTitle", "noteProperty", "paragraph"]);
    const version = (editor.getJSON().content ?? [])[1];
    expect(version.content?.[0]?.content?.[0]?.text).toBe("version"); // untouched
    expect(version.content?.[1]?.content?.map((t) => t.text).join("")).toBe("1.0");
    editor.destroy();
    el.remove();
  });

  it("right-click over a locked row opens the same menu", () => {
    const { editor, el } = build(tagsRowDoc(["one"]));
    const rowEl = el.querySelector(".note-property")!;
    rowEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    awaitAnimationFrame();
    expect(document.body.querySelector(".note-property-menu")).toBeTruthy();
    const deleteItem = document.body.querySelector(".note-property-menu__item.is-danger") as HTMLElement;
    deleteItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    awaitAnimationFrame();
    expect(editor.state.doc.content.content.map((n) => n.type.name)).toEqual([
      "noteTitle",
      "paragraph",
    ]);
    editor.destroy();
    el.remove();
  });

  it("the row menu toggles a custom row between text and list", () => {
    const { editor, el } = build({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        {
          type: "noteProperty",
          attrs: { type: "text" },
          content: [
            { type: "notePropertyName", content: [{ type: "text", text: "authors" }] },
            { type: "notePropertyValue", content: [{ type: "text", text: "One, Two" }] },
          ],
        },
        { type: "paragraph" },
      ],
    });
    const grip = el.querySelector(".note-property-grip")!;
    grip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    grip.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    awaitAnimationFrame();
    const typeItem = [...document.body.querySelectorAll(".note-property-menu__item")].find(
      (b) => b.textContent === "List",
    ) as HTMLElement;
    expect(typeItem).toBeTruthy();
    typeItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    awaitAnimationFrame();
    const row = (editor.getJSON().content ?? [])[1];
    expect(row.attrs?.type).toBe("list");
    // back to text: the single value is kept
    const grip2 = el.querySelector(".note-property-grip")!;
    grip2.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    grip2.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    awaitAnimationFrame();
    const textItem = [...document.body.querySelectorAll(".note-property-menu__item")].find(
      (b) => b.textContent?.startsWith("Text"),
    ) as HTMLElement;
    textItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    awaitAnimationFrame();
    const row2 = (editor.getJSON().content ?? [])[1];
    expect(row2.attrs?.type).toBe("text");
    expect(row2.content?.filter((n) => n.type === "notePropertyValue")).toHaveLength(1);
    editor.destroy();
    el.remove();
  });
});
