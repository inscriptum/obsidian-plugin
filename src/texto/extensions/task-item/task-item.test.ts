import { describe, it, expect } from "vitest";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";
import { applyPopGate } from "./popGate";
import { TaskItem, VIEW_TAG } from "./task-item";

function contentWithTaskItem(checked: boolean) {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [] },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "hello" }] },
            ],
          },
        ],
      },
    ],
  };
}

function renderTaskItem(checked: boolean, icons?: [string, string]) {
  const el = createDiv();
  document.body.appendChild(el);

  let extensions = getExtensions();
  if (icons != null) {
    // getExtensions hard-wires the default pair; a custom pair replaces the
    // TaskItem extension with the same shape it is configured with.
    extensions = extensions.map((e) =>
      e.name === "taskItem"
        ? TaskItem.configure({
            nested: true,
            taskFolding: true,
            checkboxIconLinks: icons,
          })
        : e,
    );
  }

  const editor = new Editor({
    element: el,
    content: contentWithTaskItem(checked),
    extensions,
    editable: true,
  });

  const item = el.querySelector(VIEW_TAG);

  return {
    item,
    editor,
    el,
    destroy: () => {
      editor.destroy();
      el.remove();
    },
  };
}

// Regression test for the checkbox not matching the design
// getExtensions() must configure TaskItem with checkboxIconLinks so the
// custom SVG icons (declared in note.element.tsx) are used instead of the
// unstyled native input[type=checkbox].
describe("taskItem checkbox rendering", () => {
  it("renders the inline default checkbox and hides the native input when unchecked", () => {
    const { item, destroy } = renderTaskItem(false);

    expect(item).toBeTruthy();
    expect(item?.getAttribute("data-checked")).toBe("false");

    // The default pair renders as the inline animated SVG (issue
    // task-item-theme), not the <use> sprite.
    const svg = item?.querySelector(".custom-icon svg.texto-task-check");
    expect(svg).toBeTruthy();
    expect(item?.querySelector(".custom-icon use")).toBeNull();

    const input = item?.querySelector('input[type="checkbox"]');
    expect(input?.classList.contains("visually-hidden")).toBe(true);

    destroy();
  });

  it("renders the sprite <use> icon for a custom icon pair (unchecked = off id)", () => {
    const { item, destroy } = renderTaskItem(false, [
      "my_on_icon",
      "my_off_icon",
    ]);

    const use = item?.querySelector(".custom-icon use");
    expect(use?.getAttribute("href")).toBe("#my_off_icon");
    // The inline default checkbox must not render for a custom pair.
    expect(item?.querySelector("svg.texto-task-check")).toBeNull();

    destroy();
  });

  it("renders the sprite <use> icon for a custom icon pair (checked = on id)", () => {
    const { item, destroy } = renderTaskItem(true, [
      "my_on_icon",
      "my_off_icon",
    ]);

    const use = item?.querySelector(".custom-icon use");
    expect(use?.getAttribute("href")).toBe("#my_on_icon");

    destroy();
  });

});

describe("applyPopGate (the box pop arming, issue task-item-theme)", () => {
  it("arms on a real false→true toggle and disarms after the animation", async () => {
    const host = createDiv();
    document.body.append(host);

    // Mount unchecked (the factory seeds data-checked before update).
    applyPopGate(host, false);
    expect(host.hasAttribute("data-pop")).toBe(false);

    // The check — the pop arms, then the attribute is dropped.
    applyPopGate(host, true);
    expect(host.getAttribute("data-pop")).toBe("");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(host.hasAttribute("data-pop")).toBe(false);

    host.remove();
  });

  it("never arms for an item mounted checked", async () => {
    const host = createDiv();
    document.body.append(host);
    // The factory seeds data-checked from the node attrs BEFORE the first
    // update — a host mounted checked arrives with the seed.
    host.dataset.checked = "true";

    applyPopGate(host, true); // the mount render, seeded checked
    expect(host.hasAttribute("data-pop")).toBe(false);

    // Re-renders of the same checked state stay unarmed...
    applyPopGate(host, true);
    expect(host.hasAttribute("data-pop")).toBe(false);

    // ...until an uncheck arms the next check again.
    applyPopGate(host, false);
    applyPopGate(host, true);
    expect(host.getAttribute("data-pop")).toBe("");

    host.remove();
  });
});
