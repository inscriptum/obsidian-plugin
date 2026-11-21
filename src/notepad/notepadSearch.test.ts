import { describe, expect, it } from "vitest";
import { Editor } from "../texto/core";
import { getExtensions } from "../texto/getExtensions";
import { buildNoteTextIndex, findMatchesInIndex } from "./notepadSearch";
import { findDocumentMatches } from "../search/documentSearch";
import type { JSONContent } from "../texto/core/@types";

function editorFor(content: JSONContent): Editor {
  const el = createDiv();
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

/** Docs exercising the size accounting: empty containers and leaf nodes
 *  before text — every one of them used to shift computed positions. */
const emptyContainersDoc: JSONContent = {
  type: "noteDoc",
  content: [
    { type: "noteTitle", content: [{ type: "text", text: "Drift fixture" }] },
    { type: "paragraph" },
    { type: "paragraph", content: [] },
    { type: "bulletList", content: [{ type: "listItem", content: [] }] },
    {
      type: "taskList",
      content: [{ type: "taskItem", attrs: { checked: false }, content: [] }],
    },
    { type: "paragraph", content: [] },
    {
      type: "paragraph",
      content: [{ type: "text", text: "target needle text" }],
    },
  ],
};

const leavesDoc: JSONContent = {
  type: "noteDoc",
  content: [
    { type: "noteTitle", content: [{ type: "text", text: "Leaves" }] },
    { type: "paragraph", content: [{ type: "text", text: "before" }] },
    { type: "image", attrs: { data: { id: "01IMG" } } },
    { type: "horizontalRule" },
    {
      type: "mermaid",
      attrs: { code: "graph TD", align: "center" },
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "word " },
        { type: "hardBreak" },
        { type: "text", text: "needle after break" },
      ],
    },
  ],
};

function expectIndexMatchesDoc(content: JSONContent, query: string): void {
  const editor = editorFor(content);
  const index = buildNoteTextIndex(editor.getJSON());
  // The doc must actually contain the query (guard against a fixture that
  // the schema coerced away).
  expect(index.text.toLowerCase()).toContain(query.toLowerCase());
  const pmMatches = findDocumentMatches(editor.state.doc, query);
  const idxMatches = findMatchesInIndex(index, query);
  expect(idxMatches.map((m) => ({ from: m.from, to: m.to }))).toEqual(
    pmMatches.map((m) => ({ from: m.from, to: m.to })),
  );
  // Every match resolves to the query text in the real document.
  for (const match of idxMatches) {
    expect(
      editor.state.doc.textBetween(match.from, match.to, "\n", ""),
    ).toBe(query);
  }
  editor.destroy();
}

describe("notepadSearch node sizes", () => {
  it("empty containers before text do not drift the positions", () => {
    expectIndexMatchesDoc(emptyContainersDoc, "needle");
  });

  it("several empty containers still land exactly", () => {
    expectIndexMatchesDoc(emptyContainersDoc, "text");
  });

  it("leaf nodes count 1, containers 2 — positions stay true across them", () => {
    expectIndexMatchesDoc(leavesDoc, "needle after break");
  });

  it("mermaid and horizontalRule before text keep positions aligned", () => {
    expectIndexMatchesDoc(leavesDoc, "word");
  });
});
