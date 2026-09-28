import { describe, expect, it } from "vitest";
import { Editor } from "../texto/core";
import { getExtensions } from "../texto/getExtensions";
import { buildNoteTextIndex, findMatchesInIndex } from "./notepadSearch";
import { findDocumentMatches } from "../search/documentSearch";
import type { JSONContent } from "../texto/core/@types";

function editorFor(content: JSONContent): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    content,
    extensions: getExtensions({}, { isMobileView: false }),
    autofocus: false,
  });
  el.remove();
  return editor;
}

const docWithMarks: JSONContent = {
  type: "noteDoc",
  content: [
    { type: "noteTitle", content: [{ type: "text", text: "Note Title" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "alpha " },
        { type: "text", marks: [{ type: "bold" }], text: "beta " },
        { type: "text", text: "gamma delta" },
      ],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "second alpha line" }],
    },
    { type: "image", attrs: { data: { id: "01IMG" } } },
    { type: "paragraph" },
  ],
};

describe("notepadSearch index", () => {
  it("matches the PM document's own search ranges", () => {
    const editor = editorFor(docWithMarks);
    const index = buildNoteTextIndex(editor.getJSON());

    for (const query of ["alpha", "beta gamma", "Title", "delta", "e"]) {
      const pmMatches = findDocumentMatches(editor.state.doc, query);
      const idxMatches = findMatchesInIndex(index, query);
      expect(idxMatches.map((m) => ({ from: m.from, to: m.to }))).toEqual(
        pmMatches.map((m) => ({ from: m.from, to: m.to })),
      );
    }
    editor.destroy();
  });

  it("maps positions that resolve to the query text in the live doc", () => {
    const editor = editorFor(docWithMarks);
    const index = buildNoteTextIndex(editor.getJSON());
    const [match] = findMatchesInIndex(index, "beta gamma");
    expect(editor.state.doc.textBetween(match.from, match.to, "\n", "")).toBe(
      "beta gamma",
    );
    editor.destroy();
  });

  it("does not produce matches crossing a non-text node", () => {
    const index = buildNoteTextIndex(docWithMarks);
    // "line" ends right before the image leaf; nothing may match across it
    const matches = findMatchesInIndex(index, "second alpha line");
    expect(matches.length).toBe(1);
    // no match can span from "Note Title" into "alpha" through the title node
    const across = findMatchesInIndex(index, "Titlealpha");
    expect(across).toEqual([]);
  });

  it("snippets carry surrounding context", () => {
    const index = buildNoteTextIndex(docWithMarks);
    const [match] = findMatchesInIndex(index, "second");
    expect(match.snippet).toContain("second alpha line");
  });
});
