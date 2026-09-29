import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { Editor } from "../../../core";
import { getExtensions } from "../../../getExtensions";

const HREF = "https://example.com/doc";

function createEditorWithLinks(): Editor {
  const errors: string[] = [];
  // One paragraph: "underlined" (underline+link), " bolded" (bold+link) and
  // " plain" (link only). ProseMirror merges consecutive text sharing the
  // same mark prefix, so all three live inside a single <a> element.
  const editor = new Editor({
    element: createDiv(),
    extensions: getExtensions(),
    onError: (err) => errors.push(String((err as Error)?.stack ?? err)),
    content: {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "underlined",
              marks: [
                { type: "underline" },
                { type: "link", attrs: { href: HREF } },
              ],
            },
            {
              type: "text",
              text: " bolded",
              marks: [
                { type: "bold" },
                { type: "link", attrs: { href: HREF } },
              ],
            },
            {
              type: "text",
              text: " plain",
              marks: [{ type: "link", attrs: { href: HREF } }],
            },
          ],
        },
      ],
    },
  });
  if (errors.length) {
    throw new Error(
      `editor failed to build: ${errors.join(" | ").slice(0, 400)}`,
    );
  }
  return editor;
}

type LinkClickHandler = (
  view: EditorView,
  pos: number,
  event: MouseEvent,
) => boolean;

/** The clickHandler plugin registers props.handleClick; fish it out of the
 *  editor state. The PluginKey suffix is a global counter, so match by
 *  prefix ("handleClickLink$", "handleClickLink$1", …). */
function getLinkClickHandler(editor: Editor): LinkClickHandler {
  type PluginWithKey = Plugin & { key?: string };
  const plugin = editor.state.plugins.find(
    (p) =>
      typeof (p as PluginWithKey).key === "string" &&
      (p as PluginWithKey).key?.startsWith("handleClickLink"),
  );
  expect(plugin, "clickHandler plugin must be registered").toBeTruthy();
  const handler = plugin?.props?.handleClick;
  expect(typeof handler, "handleClick prop must exist").toBe("function");
  return handler as unknown as LinkClickHandler;
}

describe("link clickHandler with nested marks", () => {
  const editors: Editor[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (editors.length) {
      editors.pop()?.destroy();
    }
  });

  it("opens the link when clicking text with underline inside the anchor", () => {
    const editor = createEditorWithLinks();
    editors.push(editor);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const anchor = editor.view!.dom.querySelector("a");
    const target = anchor?.querySelector("u");
    expect(target, "underline mark renders as <u> inside <a>").toBeTruthy();

    const handleClick = getLinkClickHandler(editor);
    const handled = handleClick(
      editor.view as EditorView,
      0,
      { button: 0, target } as unknown as MouseEvent,
    );

    expect(handled).toBe(true);
    expect(openSpy).toHaveBeenCalledWith(HREF, "_blank", "noopener");
  });

  it("opens the link when clicking text with bold inside the anchor", () => {
    const editor = createEditorWithLinks();
    editors.push(editor);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const target = editor.view!.dom.querySelector("a strong");
    expect(target, "bold mark renders as <strong> inside <a>").toBeTruthy();

    const handleClick = getLinkClickHandler(editor);
    const handled = handleClick(
      editor.view as EditorView,
      0,
      { button: 0, target } as unknown as MouseEvent,
    );

    expect(handled).toBe(true);
    expect(openSpy).toHaveBeenCalledWith(HREF, "_blank", "noopener");
  });

  it("still opens the link when clicking the anchor itself", () => {
    const editor = createEditorWithLinks();
    editors.push(editor);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const target = editor.view!.dom.querySelector("a");
    expect(target, "link renders as <a>").toBeTruthy();

    const handleClick = getLinkClickHandler(editor);
    const handled = handleClick(
      editor.view as EditorView,
      0,
      { button: 0, target } as unknown as MouseEvent,
    );

    expect(handled).toBe(true);
    expect(openSpy).toHaveBeenCalledWith(HREF, "_blank", "noopener");
  });

  it("ignores clicks outside any anchor", () => {
    const editor = createEditorWithLinks();
    editors.push(editor);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const target = editor.view!.dom.querySelector("p");

    const handleClick = getLinkClickHandler(editor);
    const handled = handleClick(
      editor.view as EditorView,
      0,
      { button: 0, target } as unknown as MouseEvent,
    );

    expect(handled).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
