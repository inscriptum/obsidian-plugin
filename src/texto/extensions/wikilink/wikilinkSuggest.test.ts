import { describe, it, expect } from "vitest";
import { TextSelection } from "prosemirror-state";
import { Editor } from "../../core/Editor";
import { getExtensions, type ExtensionHooks } from "../../getExtensions";
import {
  extractWikiQuery,
  filterFiles,
  scoreFile,
  acceptWikiSuggestion,
  wikiSuggestKey,
} from "./wikilinkSuggest";
import { findWikiMatches } from "./wikilink";
import type { WikiFile } from "./wikilink";

describe("extractWikiQuery", () => {
  it("parses a bare trigger", () => {
    expect(extractWikiQuery("before [[")).toEqual({
      from: 7,
      query: "",
      display: null,
    });
  });

  it("parses the query part", () => {
    expect(extractWikiQuery("[[pla")).toEqual({
      from: 0,
      query: "pla",
      display: null,
    });
  });

  it("parses query and display parts around the pipe", () => {
    expect(extractWikiQuery("text [[notes/plan|My Plan")).toEqual({
      from: 5,
      query: "notes/plan",
      display: "My Plan",
    });
  });

  it("ignores a closed link", () => {
    expect(extractWikiQuery("[[plan]]")).toBeNull();
  });

  it("ignores a single bracket", () => {
    expect(extractWikiQuery("array [0]")).toBeNull();
  });

  it("ignores text with no trigger", () => {
    expect(extractWikiQuery("plain words")).toBeNull();
  });
});

const FILES: WikiFile[] = [
  { path: "notes/planning.um", name: "planning" },
  { path: "notes/plan b.md", name: "plan b" },
  { path: "plan it all.note", name: "plan it all" },
  { path: "daily/2026-10-24.md", name: "2026-10-24" },
];

describe("filterFiles / scoreFile", () => {
  it("empty query lists the first files", () => {
    expect(filterFiles(FILES, "").length).toBe(FILES.length);
  });

  it("basename prefix outranks other matches", () => {
    const out = filterFiles(FILES, "plan");
    // Tighter prefix (shorter name) first; "2026-10-24" does not match.
    expect(out.map((f) => f.name)).toEqual(["plan b", "planning", "plan it all"]);
  });

  it("query with a path segment matches by path", () => {
    const out = filterFiles(FILES, "daily");
    expect(out.map((f) => f.name)).toEqual(["2026-10-24"]);
  });

  it("case-insensitive", () => {
    expect(filterFiles(FILES, "PLAN").length).toBe(3);
  });

  it("subsequence match works", () => {
    expect(filterFiles(FILES, "pln").map((f) => f.name)).toContain("planning");
  });

  it("no match — empty list", () => {
    expect(filterFiles(FILES, "zzz")).toEqual([]);
  });

  it("scoreFile: prefix beats inclusion beats subsequence", () => {
    const q = "plan";
    const prefix = scoreFile({ path: "p", name: "plan" }, q);
    const incl = scoreFile({ path: "p", name: "unplan" }, q);
    const sub = scoreFile({ path: "p", name: "p* l*a*n*x" }, q);
    expect(prefix).toBeGreaterThan(incl);
    expect(incl).toBeGreaterThan(sub);
  });
});

function makeEditor(hooks?: ExtensionHooks, paragraphText = "hello [[planning"): Editor {
  return new Editor({
    element: document.createElement("div"),
    content: {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        { type: "paragraph", content: [{ type: "text", text: paragraphText }] },
      ],
    },
    extensions: getExtensions(hooks),
    editable: true,
  });
}

const WIKI_HOOKS: ExtensionHooks = {
  wiki: {
    listFiles: () => FILES,
    isResolved: (path) => FILES.some((f) => f.path === path),
    openTarget: () => {},
  },
};

describe("acceptWikiSuggestion", () => {
  it("replaces the trigger with the inline syntax, caret after it", () => {
    const editor = makeEditor(WIKI_HOOKS);
    const doc = editor.state.doc;
    // caret at the end of "hello [[planning" — the title occupies 0..3,
    // the paragraph opens at 3, its text starts at 4
    const para = doc.child(1);
    const cursor = 4 + para.content.size;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, cursor)),
    );

    const file = FILES[0]!;
    const before = cursor - "[[planning".length;
    const ok = acceptWikiSuggestion(
      editor.state,
      (tr) => editor.view.dispatch(tr),
      file,
      { from: before, display: null },
      cursor,
    );
    expect(ok).toBe(true);

    const json = editor.state.doc.toJSON() as {
      content: { content?: { text?: string }[] }[];
    };
    // the document is PLAIN TEXT now (inline-syntax model)
    expect(json.content[1]!.content?.[0]?.text).toBe(
      "hello [[notes/planning.um]]",
    );
    // caret sits after the closing brackets
    expect(editor.state.selection.from).toBe(
      before + "[[notes/planning.um]]".length,
    );
    // the suggest state closed
    expect(wikiSuggestKey.getState(editor.state)?.active).toBe(false);
    editor.destroy();
  });

  it("keeps the typed display text inside the syntax", () => {
    const editor = makeEditor(WIKI_HOOKS);
    const doc = editor.state.doc;
    const para = doc.child(1);
    const cursor = 4 + para.content.size;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, cursor)),
    );
    const textStart = cursor - "[[planning".length;
    acceptWikiSuggestion(
      editor.state,
      (tr) => editor.view.dispatch(tr),
      FILES[0]!,
      { from: textStart, display: "My Plan" },
      cursor,
    );
    const json = editor.state.doc.toJSON() as {
      content: { content?: { text?: string }[] }[];
    };
    expect(json.content[1]!.content?.[0]?.text).toBe(
      "hello [[notes/planning.um|My Plan]]",
    );
    editor.destroy();
  });

  it("empty display («[[plan|») omits the pipe entirely", () => {
    const editor = makeEditor(WIKI_HOOKS);
    const doc = editor.state.doc;
    const para = doc.child(1);
    const cursor = 4 + para.content.size;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, cursor)),
    );
    const textStart = cursor - "[[planning".length;
    const ok = acceptWikiSuggestion(
      editor.state,
      (tr) => editor.view.dispatch(tr),
      FILES[0]!,
      { from: textStart, display: "" },
      cursor,
    );
    expect(ok).toBe(true);
    const json = editor.state.doc.toJSON() as {
      content: { content?: { text?: string }[] }[];
    };
    expect(json.content[1]!.content?.[0]?.text).toBe(
      "hello [[notes/planning.um]]",
    );
    editor.destroy();
  });
});

describe("findWikiMatches (decoration source)", () => {
  it("finds complete patterns with and without labels", () => {
    const editor = makeEditor(WIKI_HOOKS, "a [[x.md]] and [[y.um|the y]] b");
    const matches = findWikiMatches(editor.state);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      target: "x.md",
      label: null,
    });
    expect(matches[1]).toMatchObject({
      target: "y.um",
      label: "the y",
    });
    // textFrom/textTo span only the visible label
    expect(
      editor.state.doc.textBetween(
        matches[1]!.textFrom,
        matches[1]!.textTo,
      ),
    ).toBe("the y");
    editor.destroy();
  });

  it("ignores text without a complete pattern", () => {
    // unclosed trigger, stray single brackets
    const editor = makeEditor(WIKI_HOOKS, "[[no closing bracket and [x] here");
    expect(findWikiMatches(editor.state)).toHaveLength(0);
    editor.destroy();
  });
});
