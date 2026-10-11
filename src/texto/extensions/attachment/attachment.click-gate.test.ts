import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";
import { VIEW_TAG } from "./attachment";
import type { AttachmentElementType } from "./attachment";

/** Obsidian patches these helpers onto HTMLElement; jsdom has none. */
beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["addClass"] ??= function (this: HTMLElement, cls: string) {
    this.classList.add(cls);
  };
  proto["removeClass"] ??= function (this: HTMLElement, cls: string) {
    this.classList.remove(cls);
  };
  // ProseMirror's mousedown handler resolves coordinates; jsdom has no layout
  const doc = document as unknown as {
    elementFromPoint?: (x: number, y: number) => Element | null;
  };
  doc.elementFromPoint ??= () => null;
});

function contentWithAttachment(): Record<string, unknown> {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      {
        type: "attachment",
        attrs: {
          key: "click_gate_key",
          data: { id: "docs/file.pdf", filename: "file.pdf" },
        },
      },
      { type: "paragraph", content: [{ type: "text", text: "After" }] },
    ],
  };
}

describe("attachment click gate — select first, open on a second click", () => {
  let editor: Editor | null = null;
  let host: HTMLElement | null = null;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = null;
    host = null;
  });

  function setup(onClick: (attrs: unknown) => void) {
    host = createDiv();
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      content: contentWithAttachment(),
      extensions: getExtensions({ attachment: { onClick } }),
      editable: true,
    });
    const element = host.querySelector(VIEW_TAG) as AttachmentElementType;
    expect(element).not.toBeNull();
    const container = element.querySelector(".attachment-container");
    expect(container).not.toBeNull();
    return { element, container: container as HTMLElement };
  }

  /** A chip click is mousedown → click (the gate snapshots on mousedown). */
  function click(container: HTMLElement) {
    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    container.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function attachmentPos(): number {
    let pos = -1;
    editor!.state.doc.descendants((n, p) => {
      if (n.type.name === "attachment") {
        pos = p;
        return false;
      }
      return true;
    });
    expect(pos).toBeGreaterThan(-1);
    return pos;
  }

  it("first click does not open; a click on the selected chip opens once; a click after deselection does not", () => {
    const onClick = vi.fn();
    const { container } = setup(onClick);

    // 1. fresh click — chip is not selected: no open (this click only selects)
    click(container);
    expect(onClick).not.toHaveBeenCalled();

    // 2. the chip is selected (as the first click's mousedown would leave it):
    //    the next click opens exactly once
    editor!.commands.setNodeSelection(attachmentPos());
    click(container);
    expect(onClick).toHaveBeenCalledTimes(1);

    // 3. selection moved elsewhere: clicking again must not open
    editor!.commands.setTextSelection(1);
    click(container);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
