import { afterAll, describe, expect, it } from "vitest";
import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";
import type { JSONContent } from "../../core/@types";

// The image node view calls Obsidian's Element.addClass (no jsdom
// equivalent; vitest.setup.ts only installs the create* globals) — same
// shim approach as tests/schema/tableCellImages.test.ts.
const proto = Element.prototype as unknown as Record<string, unknown>;
const nativeClassMethods: Record<string, unknown> = {
  addClass: proto.addClass,
  removeClass: proto.removeClass,
  hasClass: proto.hasClass,
};
proto.addClass = function addClass(this: Element, classes: unknown) {
  for (const cls of Array.isArray(classes) ? classes : [classes]) {
    this.classList.add(cls as string);
  }
};
proto.removeClass = function removeClass(this: Element, classes: unknown) {
  for (const cls of Array.isArray(classes) ? classes : [classes]) {
    this.classList.remove(cls as string);
  }
};
proto.hasClass = function hasClass(this: Element, cls: string) {
  return this.classList.contains(cls);
};
afterAll(() => {
  for (const [name, value] of Object.entries(nativeClassMethods)) {
    if (value === undefined) {
      delete proto[name];
    } else {
      proto[name] = value;
    }
  }
});

function editorWithImage() {
  return new Editor({
    element: createDiv(),
    content: {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [] },
        {
          type: "image",
          attrs: {
            key: "img-1",
            align: "left",
            data: { id: "asset-1", size: "123", filename: "pic.png" },
          },
        },
      ],
    } as unknown as JSONContent,
    extensions: getExtensions(),
  });
}

describe("image host drawer-swipe opt-out (issues/image-resize-edge-swipe)", () => {
  it("marks the node-view host element with data-ignore-swipe", () => {
    // The live editor renders images through the node view — the host is
    // the touch-target ancestor of both the resize handles and the image
    // body, so one attribute opts the whole node area out of Obsidian's
    // drawer-swipe handler (the tables' accepted pattern).
    const editor = editorWithImage();
    try {
      const host = editor.view.dom.querySelector(".texto-extension-image-host");
      expect(host).not.toBeNull();
      expect(host?.getAttribute("data-ignore-swipe")).toBe("true");
    } finally {
      editor.destroy();
    }
  });

  it("the resize handles live inside the opted-out host", () => {
    const editor = editorWithImage();
    try {
      const host = editor.view.dom.querySelector(".texto-extension-image-host");
      const handle = host?.querySelector(".image-resize-handle");
      expect(handle).not.toBeNull();
      expect(handle?.closest("[data-ignore-swipe]")).toBe(host);
    } finally {
      editor.destroy();
    }
  });
});
