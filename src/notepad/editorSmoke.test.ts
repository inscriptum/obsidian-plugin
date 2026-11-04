import { describe, expect, it } from "vitest";
import { Editor } from "../texto/core";
import { getExtensions } from "../texto/getExtensions";
import { createEmptyNote } from "../storage/noteStorage";
import type { JSONContent } from "../texto/core/@types";

function build(
  content: JSONContent,
  profile: "note" | "title" | "plain" = "note",
): { ok: boolean; error?: string } {
  const el = createDiv();
  document.body.appendChild(el);
  let error: string | undefined;
  const editor = new Editor({
    element: el,
    content,
    onError: (err) => {
      error = String((err as Error)?.stack ?? err);
    },
    extensions: getExtensions({}, { isMobileView: false, profile }),
    autofocus: "start",
  });
  const ok = editor.view != null;
  if (editor.view != null) editor.destroy();
  el.remove();
  return { ok, error };
}

describe("editor smoke: content shapes used by NotepadView", () => {
  it("builds an editor for createEmptyNote() (new notepad note)", () => {
    const r = build(createEmptyNote());
    expect({ ok: r.ok, error: r.error?.slice(0, 300) }).toMatchObject({
      ok: true,
    });
  });

  it("builds an editor for a note with title text", () => {
    const doc = createEmptyNote();
    const title = doc.content?.find((n) => n.type === "noteTitle");
    if (title) title.content = [{ type: "text", text: "Hello" }];
    const r = build(doc);
    expect({ ok: r.ok, error: r.error?.slice(0, 300) }).toMatchObject({
      ok: true,
    });
  });

  it("builds an editor for an image note without a key attr", () => {
    const doc = createEmptyNote();
    doc.content?.push({
      type: "image",
      attrs: { data: { id: "01TESTIMG", size: "70", filename: "dot.png" } },
    });
    const r = build(doc);
    expect({ ok: r.ok, error: r.error?.slice(0, 300) }).toMatchObject({
      ok: true,
    });
  });

  it("builds a title-profile editor for a migrated v3 title page (properties)", () => {
    // The exact shape the v2→v3 migration produces: title + description
    // property + content block.
    const doc: JSONContent = {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        {
          type: "noteProperty",
          attrs: { type: "text" },
          content: [
            {
              type: "notePropertyName",
              content: [{ type: "text", text: "description" }],
            },
            {
              type: "notePropertyValue",
              content: [{ type: "text", text: "Legacy summary" }],
            },
          ],
        },
        {
          type: "noteProperty",
          attrs: { type: "list" },
          content: [
            {
              type: "notePropertyName",
              content: [{ type: "text", text: "tags" }],
            },
            {
              type: "notePropertyValue",
              content: [{ type: "text", text: "one" }],
            },
            {
              type: "notePropertyValue",
              content: [{ type: "text", text: "two" }],
            },
          ],
        },
        { type: "paragraph" },
      ],
    };
    const r = build(doc, "title");
    expect({ ok: r.ok, error: r.error?.slice(0, 300) }).toMatchObject({
      ok: true,
    });
  });

  it("builds a title-profile editor for an empty starter title page", () => {
    const r = build(
      {
        type: "noteDoc",
        content: [{ type: "noteTitle" }, { type: "paragraph" }],
      },
      "title",
    );
    expect({ ok: r.ok, error: r.error?.slice(0, 300) }).toMatchObject({
      ok: true,
    });
  });

  // The host router (NoteView/NotepadView handleEditorShortcut) swallows
  // every physical combo found in registeredShortcuts with preventDefault
  // before re-dispatching it into the keymap — a binding that does not run
  // for the current selection (cell cut on a text selection) therefore
  // kills the native behavior for ALL text (issues/text-cut-mod-x). Cmd+X
  // must stay unregistered: cell cut rides the DOM cut event instead.
  it("registers no Mod-x shortcut (cell cut is a DOM cut event)", () => {
    const el = createDiv();
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      content: createEmptyNote(),
      onError: () => {},
      extensions: getExtensions({}, { isMobileView: false }),
      autofocus: false,
    });
    expect(editor.registeredShortcuts.has("Mod-x")).toBe(false);
    // Sanity: other keymap shortcuts are still registered.
    expect(editor.registeredShortcuts.has("Mod-b")).toBe(true);
    editor.destroy();
    el.remove();
  });
});
