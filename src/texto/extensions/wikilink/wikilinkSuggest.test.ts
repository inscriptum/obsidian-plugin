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
import {
  findWikiMatches,
  removeWikiLink,
  selectionInWikiContext,
  startWikiEdit,
  wikiLinkRangeByPath,
} from "./wikilink";
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
    element: createDiv(),
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

/** Doc JSON of the second top-level block (the test paragraph): its runs. */
type Run = {
  type?: string;
  text?: string;
  marks?: unknown[];
  attrs?: { path?: string; text?: string };
};
function paraJson(editor: Editor): Run[] {
  const json = editor.state.doc.toJSON() as {
    content: { content?: Run[] }[];
  };
  return json.content[1].content ?? [];
}

describe("acceptWikiSuggestion — commit consumes the syntax", () => {
  it("replaces the trigger with the marked label, caret after it", () => {
    const editor = makeEditor(WIKI_HOOKS);
    const doc = editor.state.doc;
    // caret at the end of "hello [[planning" — the title occupies 0..3,
    // the paragraph opens at 3, its text starts at 4
    const para = doc.child(1);
    const cursor = 4 + para.content.size;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, cursor)),
    );

    const file = FILES[0];
    const before = cursor - "[[planning".length;
    const ok = acceptWikiSuggestion(
      editor.state,
      (tr) => editor.view.dispatch(tr),
      file,
      { from: before, display: null },
      cursor,
    );
    expect(ok).toBe(true);

    const runs = paraJson(editor);
    // the raw syntax is GONE — an inline atom node remains (the owner's
    // «Способ 1»): label + target in attrs, the caret can never enter it
    expect(runs).toHaveLength(2);
    expect(runs[0].text).toBe("hello ");
    expect(runs[1].type).toBe("wikiLink");
    expect(runs[1].attrs).toEqual({
      path: "notes/planning.um",
      text: "planning",
    });
    // an atom node occupies one position — the caret sits right after it
    expect(editor.state.selection.from).toBe(before + 1);
    // the suggest state closed
    expect(wikiSuggestKey.getState(editor.state)?.active).toBe(false);
    editor.destroy();
  });

  it("keeps the typed display text as the label", () => {
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
      FILES[0],
      { from: textStart, display: "My Plan" },
      cursor,
    );
    const runs = paraJson(editor);
    expect(runs[1].type).toBe("wikiLink");
    expect(runs[1].attrs).toEqual({
      path: "notes/planning.um",
      text: "My Plan",
    });
    editor.destroy();
  });

  it("accepting with the caret mid-label keeps the whole label", () => {
    const editor = makeEditor(WIKI_HOOKS, "hello [[planning.um|My Plan]]");
    const paraText = "hello [[planning.um|My Plan]]";
    const patStart = 4 + paraText.indexOf("[[");
    const patLen = "[[planning.um|My Plan]]".length;
    const caretMidLabel = patStart + "[[planning.um|".length + "My".length;
    const ok = acceptWikiSuggestion(
      editor.state,
      (tr) => editor.view.dispatch(tr),
      FILES[0],
      {
        from: patStart,
        display: "My",
        closeEnd: patStart + patLen,
      },
      caretMidLabel,
    );
    expect(ok).toBe(true);
    const runs = paraJson(editor);
    const atom = runs.find((r) => r.type === "wikiLink");
    expect(atom?.attrs).toEqual({
      path: "notes/planning.um",
      text: "My Plan",
    });
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
    const ok = acceptWikiSuggestion(
      editor.state,
      (tr) => editor.view.dispatch(tr),
      FILES[0],
      { from: textStart, display: "" },
      cursor,
    );
    expect(ok).toBe(true);
    const runs = paraJson(editor);
    expect(runs[1].attrs).toEqual({
      path: "notes/planning.um",
      text: "planning",
    });
    editor.destroy();
  });
});

/** Simulate real typing through the view's handleTextInput — the same path
 *  prosemirror-inputrules uses, so input rules actually fire. */
function typeText(editor: Editor, text: string): void {
  const view = editor.view;
  type TextInputProp = (
    view: Editor["view"],
    from: number,
    to: number,
    text: string,
  ) => boolean;
  const callInput: TextInputProp =
    view.someProp("handleTextInput", (f) => f as TextInputProp) ??
    (() => false);
  for (const ch of text) {
    const pos = view.state.selection.from;
    const before: unknown = view.state.doc.toJSON();
    callInput(view, pos, pos, ch);
    // if no rule consumed the char, insert it the plain way
    if (
      view.state.selection.from === pos &&
      JSON.stringify(before) === JSON.stringify(view.state.doc.toJSON())
    ) {
      view.dispatch(view.state.tr.insertText(ch, pos, pos));
    }
  }
}

describe("the creation session over plain text", () => {
  it("typing «[[» auto-closes and opens the suggest session", () => {
    const editor = makeEditor(WIKI_HOOKS, "hello ");
    const doc = editor.state.doc;
    const para = doc.child(1);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(doc, 4 + para.content.size),
      ),
    );
    typeText(editor, "[[");
    expect(editor.state.doc.textBetween(4, editor.state.doc.content.size - 1)).toBe(
      "hello [[]]",
    );
    const suggest = wikiSuggestKey.getState(editor.state);
    expect(suggest?.active).toBe(true);
    // caret between the brackets
    expect(suggest?.from).toBe(4 + "hello ".length);
    editor.destroy();
  });

  it("manually completed syntax commits into a link (bold parity)", () => {
    // Existing raw text WITHOUT the auto-closed pair (an abandoned session):
    // typing the closing «]]» letter by letter must commit like the bold
    // input rule consumes «**».
    const editor = makeEditor(WIKI_HOOKS, "hello [[");
    const doc = editor.state.doc;
    const para = doc.child(1);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(doc, 4 + para.content.size),
      ),
    );
    typeText(editor, "x.md]]");
    const runs = paraJson(editor);
    const atom = runs.find((r) => r.type === "wikiLink");
    expect(atom?.attrs).toEqual({ path: "x.md", text: "x.md" });
    // no raw syntax left behind
    expect(editor.state.doc.textContent).not.toContain("[[");
    editor.destroy();
  });

  it("leaving the pattern commits it (caret exit, owner flow step 2)", () => {
    const editor = makeEditor(WIKI_HOOKS, "hello ");
    const doc = editor.state.doc;
    const para = doc.child(1);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(doc, 4 + para.content.size),
      ),
    );
    typeText(editor, "[[");
    editor.view.dispatch(
      editor.state.tr.setMeta(wikiSuggestKey, { dismissed: true }),
    );
    typeText(editor, "x.md");
    // the auto-closed pair sits after the caret: [[x.md]] — exit to the end
    const end = 4 + "hello [[x.md]]".length;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
    );
    const runs = paraJson(editor);
    const atom = runs.find((r) => r.type === "wikiLink");
    expect(atom?.attrs).toEqual({ path: "x.md", text: "x.md" });
    editor.destroy();
  });

  it("no commit when the caret was never inside the pattern (undo safety)", () => {
    const editor = makeEditor(
      WIKI_HOOKS,
      "hello [[x.md]] there",
    );
    const doc = editor.state.doc;
    // caret at the end, outside the pattern (like after an undone accept)
    const para = doc.child(1);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(doc, 4 + para.content.size),
      ),
    );
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    // still raw — a stray complete pattern with no editing session stays
    expect(findWikiMatches(editor.state)).toHaveLength(1);
    editor.destroy();
  });
});

describe("committed links", () => {
  function makeCommittedEditor(): Editor {
    const editor = makeEditor(WIKI_HOOKS, "hello  done");
    const insertAt = 4 + "hello ".length;
    const tr = editor.state.tr.replaceWith(
      insertAt,
      insertAt,
      editor.state.schema.nodes.wikiLink.create({
        path: "notes/planning.um",
        text: "planning",
      }),
    );
    // outside history: the undo test below must exercise the DELETE step,
    // not the fixture insert
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
    return editor;
  }

  it("renders from stored JSON and resolves through wikiLinkRangeByPath", () => {
    const editor = makeCommittedEditor();
    const dom = editor.view.dom;
    const span = dom.querySelector<HTMLElement>("span.texto-wikilink");
    expect(span?.getAttribute("data-wiki-path")).toBe("notes/planning.um");
    expect(span?.textContent).toBe("planning");

    const range = wikiLinkRangeByPath(editor.state, "notes/planning.um");
    expect(range).toMatchObject({
      path: "notes/planning.um",
      label: "planning",
    });
    editor.destroy();
  });

  it("plain-text copy keeps the label (renderText)", () => {
    const editor = makeCommittedEditor();
    // the node's plain-text serialization reads attrs.text (renderText)
    const node = editor.state.doc.nodeAt(4 + "hello ".length);
    expect(node?.type.name).toBe("wikiLink");
    expect(String(node?.attrs.text ?? "")).toBe("planning");
    editor.destroy();
  });

  it("raw scan skips atom nodes (no double conversion)", () => {
    const editor = makeCommittedEditor();
    expect(findWikiMatches(editor.state)).toHaveLength(0);
    editor.destroy();
  });

  it("Edit dissolves the link back into raw syntax and reopens the suggest", () => {
    const editor = makeCommittedEditor();
    const range = wikiLinkRangeByPath(editor.state, "notes/planning.um")!;
    startWikiEdit(editor.view, range);
    // the raw pattern is back, caret at the end of the path
    expect(editor.state.doc.textContent).toContain(
      "[[notes/planning.um|planning]]",
    );
    const suggest = wikiSuggestKey.getState(editor.state);
    expect(suggest?.active).toBe(true);
    expect(suggest?.query).toBe("notes/planning.um");
    // the caret sits before the pipe: the display part is not "typed" yet
    expect(suggest?.display).toBeNull();
    // accepting now must KEEP the existing label (it follows the pipe)
    acceptWikiSuggestion(
      editor.state,
      (tr) => editor.view.dispatch(tr),
      FILES[0],
      { from: suggest!.from, display: suggest!.display, closeEnd: suggest!.closeEnd },
      editor.state.selection.from,
    );
    const runs = paraJson(editor);
    const atom = runs.find((r) => r.type === "wikiLink");
    expect(atom?.attrs).toEqual({
      path: "notes/planning.um",
      text: "planning",
    });
    editor.destroy();
  });

  it("Delete replaces the atom with its plain label text (caret after it)", () => {
    const editor = makeCommittedEditor();
    const range = wikiLinkRangeByPath(editor.state, "notes/planning.um")!;
    removeWikiLink(editor.view, range);
    const runs = paraJson(editor);
    // the link is gone, the words remain as plain text (the fixture's
    // " done" tail stays)
    expect(runs.some((r) => r.type === "wikiLink")).toBe(false);
    expect(runs.map((r) => r.text).join("")).toBe("hello planning done");
    expect(editor.state.selection.from).toBe(
      4 + "hello ".length + "planning".length,
    );
    editor.destroy();
  });

  it("Delete is undoable (plain dispatched transaction)", () => {
    const editor = makeCommittedEditor();
    const range = wikiLinkRangeByPath(editor.state, "notes/planning.um")!;
    removeWikiLink(editor.view, range);
    editor.commands.undo();
    const runs = paraJson(editor);
    const atom = runs.find((r) => r.type === "wikiLink");
    expect(atom?.attrs).toEqual({
      path: "notes/planning.um",
      text: "planning",
    });
    editor.destroy();
  });

  it("selection over the atom suppresses the formatting bubble", () => {
    const editor = makeCommittedEditor();
    const from = 4 + "hello ".length;
    // a text selection covering the atom node (one position wide)
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, from + 1),
    );
    editor.view.dispatch(tr);
    expect(selectionInWikiContext(editor.state)).toBe(true);
    editor.destroy();
  });

  it("plain text selections are not wiki context", () => {
    const editor = makeEditor(WIKI_HOOKS, "plain words");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 4, 8),
      ),
    );
    expect(selectionInWikiContext(editor.state)).toBe(false);
    editor.destroy();
  });
});

describe("findWikiMatches (raw patterns)", () => {
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
    editor.destroy();
  });

  it("the review scenario: caret inside a saved code pattern, then exit — the code stays code", () => {
    const editor = new Editor({
      element: createDiv(),
      content: {
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "T" }] },
          { type: "hljsCodeBlock", content: [
            { type: "hljsCodeBlockRow", content: [
              { type: "text", text: "example [[target]] here" },
            ] },
          ] },
        ],
      },
      extensions: getExtensions(WIKI_HOOKS),
      editable: true,
    });
    // caret INTO the pattern inside the code row (the review's action)
    let patStart: number | null = null;
    editor.state.doc.descendants((node, at) => {
      if (!patStart && node.isText && node.text?.includes("[[target]]")) {
        patStart = at + node.text.indexOf("[[target]]");
      }
      return !patStart;
    });
    editor.commands.setTextSelection(patStart! + 5);
    editor.view.focus();
    // …then click elsewhere (a selection transaction out of the pattern)
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.focus();
    // finalizeOnExit runs synchronously in appendTransaction — the state is
    // already final here
    const codeJson = JSON.stringify(editor.state.doc.child(1).toJSON());
    expect(codeJson).not.toContain('"type":"wikiLink"');
    expect(codeJson).toContain("[[target]]");
    editor.destroy();
  });

  it("skips raw patterns inside code contexts", () => {
    const editor = new Editor({
      element: createDiv(),
      content: {
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "T" }] },
          { type: "paragraph", content: [
            { type: "text", text: "inline [[quoted.md]] and " },
            { type: "text", text: "[[also.md]]", marks: [{ type: "code" }] },
          ] },
          { type: "hljsCodeBlock", content: [
            { type: "hljsCodeBlockRow", content: [
              { type: "text", text: "[[incode.md]]" },
            ] },
          ] },
        ],
      },
      extensions: getExtensions(WIKI_HOOKS),
      editable: true,
    });
    const matches = findWikiMatches(editor.state);
    // only the live inline one is visible to the scanner; the code-marked
    // and code-block patterns are skipped
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ target: "quoted.md" });
    editor.destroy();
  });

  it("ignores text without a complete pattern", () => {
    // unclosed trigger, stray single brackets
    const editor = makeEditor(WIKI_HOOKS, "[[no closing bracket and [x] here");
    expect(findWikiMatches(editor.state)).toHaveLength(0);
    editor.destroy();
  });
});
