import { describe, expect, it } from "vitest";
import { EditorState } from "prosemirror-state";

import { buildSchema } from "../../../../tests/helpers/buildSchema";

import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";

import { TaskItem, VIEW_TAG } from "./task-item";
import { applyTaskCascade } from "./applyTaskCascade";

const schema = buildSchema();

const task = (text: string, checked: boolean) => ({
  type: "taskItem",
  attrs: { checked },
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** parent (state `parent`) with subs ["sub one", "sub two"]; an optional
 *  sub-sub nested under "sub one" (state `subsub`) */
function buildDocJson(
  parent: boolean,
  subs: [boolean, boolean],
  subsub?: boolean,
) {
  const subOneContent: object[] = [
    { type: "paragraph", content: [{ type: "text", text: "sub one" }] },
  ];
  if (subsub !== undefined) {
    subOneContent.push({
      type: "taskList",
      content: [task("sub-sub", subsub)],
    });
  }
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [] },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: parent },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "parent" }],
              },
              {
                type: "taskList",
                content: [
                  { ...task("sub one", subs[0]), content: subOneContent },
                  task("sub two", subs[1]),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

type Doc = ReturnType<typeof schema.nodeFromJSON>;

function states(doc: Doc): boolean[] {
  const out: boolean[] = [];
  doc.descendants((node) => {
    if (node.type.name === "taskItem") out.push(node.attrs.checked);
    return true;
  });
  return out;
}

function itemPositions(doc: Doc): number[] {
  const out: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "taskItem") out.push(pos);
    return true;
  });
  return out;
}

/** Mirror the app contract: the caller flips the clicked item in the
 *  transaction, then the cascade runs over the same transaction. */
function runCascade(
  json: ReturnType<typeof buildDocJson>,
  flipIndex: number,
  checked: boolean,
) {
  const doc = schema.nodeFromJSON(json);
  const positions = itemPositions(doc);
  const tr = EditorState.create({ doc }).tr;
  const item = tr.doc.nodeAt(positions[flipIndex]);
  tr.setNodeMarkup(positions[flipIndex], undefined, {
    ...item?.attrs,
    checked,
  });
  applyTaskCascade(
    tr,
    positions[flipIndex],
    checked,
    item,
    schema.nodes.taskItem,
    true,
  );
  const next = EditorState.create({ doc }).apply(tr);
  return states(next.doc);
}

describe("dependent sub-tasks click-path threading", () => {
  it("the option threads getExtensions → handleCheckboxClick (one click cascades)", () => {
    const el = createDiv();
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      content: {
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [] },
          { type: "taskList", content: [
            { type: "taskItem", attrs: { checked: false }, content: [
              { type: "paragraph", content: [{ type: "text", text: "parent" }] },
              { type: "taskList", content: [
                { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "sub" }] }] },
              ] },
            ] },
          ] },
        ],
      },
      extensions: getExtensions(undefined, { dependentSubtasks: true }),
      editable: true,
    });
    const label = el.querySelector(VIEW_TAG)?.querySelector("label");
    label?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const out: boolean[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "taskItem") out.push(n.attrs.checked);
      return true;
    });
    expect(out).toEqual([true, true]);
    editor.destroy();
    el.remove();
  });

  it("one toggle is one undo step", () => {
    const el = createDiv();
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      content: {
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [] },
          { type: "taskList", content: [
            { type: "taskItem", attrs: { checked: false }, content: [
              { type: "paragraph", content: [{ type: "text", text: "parent" }] },
              { type: "taskList", content: [
                { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "sub" }] }] },
              ] },
            ] },
          ] },
        ],
      },
      extensions: getExtensions(undefined, { dependentSubtasks: true }),
      editable: true,
    });
    const label = el.querySelector(VIEW_TAG)?.querySelector("label");
    label?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(states(editor.state.doc)).toEqual([true, true]);
    // One undo reverts the whole cascade (the toggle is one transaction).
    editor.commands.undo();
    expect(states(editor.state.doc)).toEqual([false, false]);
    editor.destroy();
    el.remove();
  });
});

describe("applyTaskCascade (experimental dependent sub-tasks)", () => {
  it("off: no cascade — the flipped item changes alone", () => {
    const doc = schema.nodeFromJSON(buildDocJson(false, [false, false]));
    const positions = itemPositions(doc);
    const tr = EditorState.create({ doc }).tr;
    const item = tr.doc.nodeAt(positions[0]);
    applyTaskCascade(
      tr,
      positions[0],
      true,
      item,
      schema.nodes.taskItem,
      false,
    );
    const next = EditorState.create({ doc }).apply(tr);
    expect(states(next.doc)).toEqual([false, false, false]);
  });

  it("on: checking the parent checks all descendants", () => {
    const result = runCascade(buildDocJson(false, [false, false]), 0, true);
    expect(result).toEqual([true, true, true]);
  });

  it("on: unchecking a sub unchecks the parent chain, siblings keep state", () => {
    const result = runCascade(buildDocJson(true, [true, true]), 1, false);
    expect(result).toEqual([false, false, true]);
  });

  it("on: unchecking the parent leaves the children as they are", () => {
    const result = runCascade(buildDocJson(true, [true, true]), 0, false);
    expect(result).toEqual([false, true, true]);
  });

  it("on: deep chains — a grandchild uncheck unchecks the whole chain", () => {
    // document order: parent, sub one, sub-sub (inside sub one), sub two
    const result = runCascade(buildDocJson(true, [true, true], true), 2, false);
    expect(result).toEqual([false, false, false, true]);
  });
});
