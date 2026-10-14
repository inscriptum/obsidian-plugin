import { describe, expect, it } from "vitest";
import { Editor } from "../texto/core";
import { getExtensions } from "../texto/getExtensions";
import { createEmptyNote } from "../storage/noteStorage";
import type { JSONContent } from "../texto/core/@types";

function build(
  content: JSONContent,
  profile: "note" | "title" | "plain" = "note",
): { ok: boolean; error?: string } {
  const el = document.createElement("div");
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
            { type: "notePropertyName", content: [{ type: "text", text: "tags" }] },
            { type: "notePropertyValue", content: [{ type: "text", text: "one" }] },
            { type: "notePropertyValue", content: [{ type: "text", text: "two" }] },
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
});
