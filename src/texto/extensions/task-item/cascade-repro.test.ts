import { describe, it, expect } from "vitest";
import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";
import { VIEW_TAG } from "./task-item";

function contentNested() {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [] },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "parent" }] },
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    attrs: { checked: false },
                    content: [
                      { type: "paragraph", content: [{ type: "text", text: "sub1" }] },
                    ],
                  },
                  {
                    type: "taskItem",
                    attrs: { checked: false },
                    content: [
                      { type: "paragraph", content: [{ type: "text", text: "sub2" }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function checkedStates(editor: InstanceType<typeof Editor>): (boolean | undefined)[] {
  const out: (boolean | undefined)[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "taskItem") out.push(node.attrs.checked);
    return true;
  });
  return out;
}

describe("default off: clicking a parent does not cascade", () => {
  it("clicking the parent checkbox", () => {
    const el = createDiv();
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      content: contentNested(),
      extensions: getExtensions(),
      editable: true,
    });

    expect(checkedStates(editor)).toEqual([false, false, false]);

    // click the PARENT's label (first host) — one click: the flip
    // recreates the view in jsdom, further clicks would land on a detached
    // label and silently no-op
    const hosts = el.querySelectorAll(VIEW_TAG);
    expect(hosts.length).toBe(3);
    const parentLabel = hosts[0].querySelector("label");
    parentLabel?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(checkedStates(editor)).toEqual([true, false, false]);

    editor.destroy();
    el.remove();
  });
});
