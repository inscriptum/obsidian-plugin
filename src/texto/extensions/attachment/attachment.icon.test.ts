import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";
import { performBlockMove, findDraggableBlock } from "../drag-handle/dragHandlePlugin";
import { VIEW_TAG } from "./attachment";
import type { AttachmentElementType } from "./attachment";

/** Obsidian patches these helpers onto HTMLElement; jsdom has none. */
beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["addClass"] ??= function (cls: string) {
    (this as HTMLElement).classList.add(cls);
  };
  proto["removeClass"] ??= function (cls: string) {
    (this as HTMLElement).classList.remove(cls);
  };
  proto["toggleClass"] ??= function (cls: string, value?: boolean) {
    (this as HTMLElement).classList.toggle(cls, value);
  };
});

/**
 * Regression test: after a drag-move (performBlockMove deletes + re-inserts
 * the node, recreating its node view) the attachment's file icon must keep
 * its intrinsic size — `viewBox`, `width`, `height`. The icon svg is driven
 * by a SHARED generator: every re-render used to replace the generator's
 * params with props that omit `viewBox`, wiping it to `viewBox=""` — an svg
 * without intrinsic ratio then falls back to the browser default 300×150
 * and the icon visually blew up over the note content.
 */
function contentWithAttachment(): Record<string, unknown> {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      {
        type: "attachment",
        attrs: {
          key: "test_attachment_key",
          data: { id: "test-file-id", filename: "file.png" },
        },
      },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ],
  };
}

describe("attachment icon survives a drag-move", () => {
  let editor: Editor | null = null;
  let host: HTMLElement | null = null;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = null;
    host = null;
  });

  function iconSvg(): SVGElement {
    const element = host!.querySelector(VIEW_TAG) as AttachmentElementType;
    expect(element).not.toBeNull();
    const svg = element.querySelector(".icon-note-wrap svg");
    expect(svg).not.toBeNull();
    return svg as unknown as SVGElement;
  }

  it("keeps viewBox and explicit size after a block move", () => {
    host = createDiv();
    document.body.appendChild(host);

    editor = new Editor({
      element: host,
      content: contentWithAttachment(),
      extensions: getExtensions(),
      editable: true,
    });

    const assertHealthy = () => {
      const svg = iconSvg();
      // viewBox must never be wiped to ""
      expect(svg.getAttribute("viewBox")).toBe("0 0 20 20");
      // intrinsic size — immune to CSS/generator drift
      expect(svg.getAttribute("width")).toBe("20");
      expect(svg.getAttribute("height")).toBe("20");
    };

    // healthy on first render
    assertHealthy();

    // drag-move the attachment down (like the drag handle does)
    const state = editor.view.state;
    const doc = state.doc;
    let attachmentFrom: number | null = null;
    doc.forEach((node, pos) => {
      if (node.type.name === "attachment" && attachmentFrom == null) {
        attachmentFrom = pos;
      }
    });
    expect(attachmentFrom).not.toBeNull();

    const block = findDraggableBlock(doc, attachmentFrom!);
    expect(block).not.toBeNull();
    expect(block!.node.type.name).toBe("attachment");

    // drop at the end of the document (after the last paragraph)
    const moved = performBlockMove(editor.view, block!, doc.content.size);
    expect(moved).toBe(true);

    // the node view was recreated — the icon must still be intact
    assertHealthy();
  });
});
