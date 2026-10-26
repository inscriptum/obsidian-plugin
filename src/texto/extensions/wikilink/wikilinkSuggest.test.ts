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
  { path: "daily/2026-10-24.md", name: "2026-10-24" },
  { path: "plan it all.note", name: "plan it all" },
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

function makeEditor(hooks?: ExtensionHooks): Editor {
  return new Editor({
    element: document.createElement("div"),
    content: {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        { type: "paragraph", content: [{ type: "text", text: "hello [[planning" }] },
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

describe("filterTransaction: Enter on Android", () => {
  // prosemirror-view skips handleKeyDown for Enter on Android — the plugin
  // must intercept the Enter-produced split transaction instead.
  function makeEditorWithView(hooks: ExtensionHooks): Editor {
    return new Editor({
      element: document.createElement("div"),
      content: {
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "T" }] },
          { type: "paragraph", content: [{ type: "text", text: "see [[plann" }] },
        ],
      },
      extensions: getExtensions(hooks),
      editable: true,
    });
  }

  it("blocks the split and accepts the highlighted file", async () => {
    const editor = makeEditorWithView(WIKI_HOOKS);
    const doc = editor.state.doc;
    const para = doc.child(1);
    const cursor = 4 + para.content.size;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, cursor)),
    );
    expect(wikiSuggestKey.getState(editor.state)?.active).toBe(true);

    // the Android Enter: a bare split transaction
    editor.view.dispatch(editor.state.tr.split(cursor));
    await new Promise((r) => setTimeout(r, 50)); // the delayed accept

    const json = editor.state.doc.toJSON() as {
      content: { type: string; content?: { text?: string; marks?: { type?: string; attrs?: { path?: string } }[] }[] }[];
    };
    // the split was blocked: still a single paragraph
    expect(json.content).toHaveLength(2);
    const run = json.content[1]!.content?.find((r) => r.marks?.length);
    expect(run?.marks?.[0]?.type).toBe("wikiLink");
    expect(run?.marks?.[0]?.attrs?.path).toBe("notes/planning.um");
    editor.destroy();
  });
});

describe("acceptWikiSuggestion", () => {
  it("replaces the trigger with a marked link and puts the caret after", () => {
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
      content: { type: string; content?: { type: string; text?: string; marks?: { type: string; attrs?: { path?: string } }[] }[] }[];
    };
    const paraJson = json.content[1]!;
    // The marked run is its own text node (different marks split runs).
    const run = paraJson.content?.find((r) => r.marks?.length);
    expect(run?.text).toBe("planning");
    expect(run?.marks?.[0]?.type).toBe("wikiLink");
    expect(run?.marks?.[0]?.attrs?.path).toBe("notes/planning.um");
    // the unmarked prefix stays intact
    expect(paraJson.content?.[0]?.text).toBe("hello ");

    // caret sits after the link text
    expect(editor.state.selection.from).toBe(before + "planning".length);
    // the suggest state closed
    expect(wikiSuggestKey.getState(editor.state)?.active).toBe(false);
    editor.destroy();
  });

  it("uses the typed display text when present", () => {
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
      content: { content?: { text?: string; marks?: { attrs?: { path?: string } }[] }[] }[];
    };
    const run = json.content[1]!.content?.find((r) => r.marks?.length);
    expect(run?.text).toBe("My Plan");
    expect(run?.marks?.[0]?.attrs?.path).toBe("notes/planning.um");
    expect(json.content[1]!.content?.[0]?.text).toBe("hello ");
    editor.destroy();
  });

  it("empty display («[[plan|») falls back to the file name", () => {
    const editor = makeEditor(WIKI_HOOKS);
    const doc = editor.state.doc;
    const para = doc.child(1);
    const cursor = 4 + para.content.size;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, cursor)),
    );
    const textStart = cursor - "[[planning".length;
    // simulate «[[planning|» — display is the empty string
    const ok = acceptWikiSuggestion(
      editor.state,
      (tr) => editor.view.dispatch(tr),
      FILES[0]!,
      { from: textStart, display: "" },
      cursor,
    );
    expect(ok).toBe(true);
    const json = editor.state.doc.toJSON() as {
      content: { content?: { text?: string; marks?: { attrs?: { path?: string } }[] }[] }[];
    };
    const run = json.content[1]!.content?.find((r) => r.marks?.length);
    expect(run?.text).toBe("planning");
    expect(run?.marks?.[0]?.attrs?.path).toBe("notes/planning.um");
    editor.destroy();
  });

  it("serialization round-trips the mark through JSON", () => {
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
      FILES[2]!,
      { from: textStart, display: null },
      cursor,
    );
    const json = editor.state.doc.toJSON();
    editor.destroy();

    // A fresh editor parses the stored JSON back with the same mark.
    const second = new Editor({
      element: document.createElement("div"),
      content: json,
      extensions: getExtensions(WIKI_HOOKS),
      editable: true,
    });
    const paraRuns = (second.state.doc.toJSON() as typeof json).content[1]!
      .content!;
    const run = paraRuns.find(
      (r: { marks?: { type?: string }[] }) => r.marks?.length,
    )!;
    expect(run.marks?.[0]?.type).toBe("wikiLink");
    expect(run.marks?.[0]?.attrs?.path).toBe("daily/2026-10-24.md");
    expect(run.text).toBe("2026-10-24");
    second.destroy();
  });
});
