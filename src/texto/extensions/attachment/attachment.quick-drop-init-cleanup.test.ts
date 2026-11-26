import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";

/**
 * Premise the quick-drop policies stand on: a chip reloaded from saved
 * JSON never keeps its quick-drop state. The nodeState plugin's init
 * deletes attachment nodes without data.id from parsed initial content
 * (interrupted-upload leftover policy), so a data-less chip from a
 * previous session cannot reach a live session — dismissing "any future
 * dialog" on such a chip would delete a block the user asked for.
 */

/** Obsidian patches these helpers onto HTMLElement; jsdom has none. */
beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["addClass"] ??= function (this: HTMLElement, cls: string) {
    this.classList.add(cls);
  };
  proto["removeClass"] ??= function (this: HTMLElement, cls: string) {
    this.classList.remove(cls);
  };
});

describe("nodeState init cleanup of data-less attachment chips", () => {
  let editor: Editor | null = null;
  let host: HTMLElement | null = null;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = null;
    host = null;
  });

  it("a chip loaded from JSON (quick-drop flag, no data.id) is deleted at open", () => {
    host = createDiv();
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      content: {
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
          {
            type: "attachment",
            attrs: { key: "x", state: { isQuickDrop: true } },
          },
          { type: "paragraph", content: [{ type: "text", text: "After" }] },
        ],
      },
      extensions: getExtensions(),
      editable: true,
    });

    let chips = 0;
    const blocks: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "attachment") chips += 1;
      return true;
    });
    editor.state.doc.forEach((node) => {
      blocks.push(node.type.name);
    });

    expect(chips).toBe(0);
    // the doc shape survives: title and the untouched paragraph
    expect(blocks).toEqual(["noteTitle", "paragraph"]);
  });

  it("an attached chip (data.id present) is kept at open", () => {
    host = createDiv();
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      content: {
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
          {
            type: "attachment",
            attrs: {
              key: "kept",
              data: { id: "docs/file.pdf", filename: "file.pdf" },
            },
          },
        ],
      },
      extensions: getExtensions(),
      editable: true,
    });

    let chips = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "attachment") chips += 1;
      return true;
    });
    expect(chips).toBe(1);
  });
});
