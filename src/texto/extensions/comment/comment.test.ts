import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import type { DecorationSet } from "prosemirror-view";
import { Editor } from "../../../texto/core";
import { getExtensions } from "../../../texto/getExtensions";
import type { JSONContent } from "../../../texto/core/@types";
import {
  findCommentRanges,
  getCommentRanges,
  refreshComments,
  jsonHasCommentMark,
  stripCommentMarkFromJson,
  type CommentHooks,
} from "./index";

function buildEditor(
  content: JSONContent,
  hooks?: CommentHooks,
  profile: "note" | "title" | "plain" = "plain",
): Editor {
  const el = createDiv();
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    content,
    extensions: getExtensions(
      { comments: hooks },
      { isMobileView: false, profile },
    ),
    autofocus: false,
  });
  return editor;
}

function paragraphWithAnchor(id: string, text = "anchored"): JSONContent {
  return {
    type: "paragraph",
    content: [
      { type: "text", text: "before " },
      { type: "text", text, marks: [{ type: "comment", attrs: { id } }] },
      { type: "text", text: " after" },
    ],
  };
}

const plainDoc = (content: JSONContent[]): JSONContent => ({
  type: "noteDoc",
  content,
});

describe("comment mark", () => {
  it("survives getJSON round trip (stored verbatim, PM JSON)", () => {
    const editor = buildEditor(plainDoc([paragraphWithAnchor("T1")]));
    const json = editor.getJSON();
    const text = json.content?.[0]?.content?.[1];
    expect(text?.marks?.[0]).toMatchObject({
      type: "comment",
      attrs: { id: "T1" },
    });
    editor.destroy();
  });

  it("setComment marks the selection; unsetComment lifts the id everywhere", () => {
    const editor = buildEditor(
      plainDoc([
        { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
      ]),
    );
    const { state } = editor;
    // "hello world" occupies 1..12 inside the doc.
    editor.view.dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 12)),
    );
    expect(editor.commands.setComment({ id: "T2" })).toBe(true);
    expect(findCommentRanges(editor.state.doc)).toEqual([
      { id: "T2", from: 1, to: 12 },
    ]);
    expect(editor.commands.unsetComment("T2")).toBe(true);
    expect(findCommentRanges(editor.state.doc)).toEqual([]);
    expect(editor.commands.unsetComment("T2")).toBe(false);
    editor.destroy();
  });

  it("keeps the anchor through edits inside the range (mark stretches)", () => {
    // Fixture: "before " (1..8) + anchored "anchored" (8..16) + " after".
    const editor = buildEditor(plainDoc([paragraphWithAnchor("T4")]));
    // Type inside the anchor, after its 4th character.
    editor.commands.insertContentAt(12, "!");
    // The anchor now covers "anch!ored" (9 chars) — stretched, not broken.
    expect(findCommentRanges(editor.state.doc)).toEqual([
      { id: "T4", from: 8, to: 17 },
    ]);
    editor.destroy();
  });
});

describe("comments plugin ranges", () => {
  it("merges adjacent same-id text nodes; separate paragraphs stay apart", () => {
    const editor = buildEditor(
      plainDoc([
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "anch",
              marks: [{ type: "comment", attrs: { id: "T1" } }],
            },
            {
              type: "text",
              text: "ored",
              marks: [{ type: "comment", attrs: { id: "T1" } }],
            },
          ],
        },
        paragraphWithAnchor("T1"),
      ]),
    );
    const ranges = findCommentRanges(editor.state.doc);
    // First paragraph: two JSON text nodes → one contiguous range.
    expect(ranges[0]).toEqual({ id: "T1", from: 1, to: 9 });
    expect(ranges).toHaveLength(2);
    expect(getCommentRanges(editor.state.doc, "T1")).toHaveLength(2);
    expect(getCommentRanges(editor.state.doc, "missing")).toEqual([]);
    editor.destroy();
  });
});

describe("comments plugin decorations", () => {
  const pluginState = (editor: Editor) => {
    for (const plugin of editor.state.plugins) {
      const raw: unknown = plugin.getState(editor.state);
      const state = raw as
        | { ranges?: unknown[]; decorations?: DecorationSet }
        | undefined;
      if (state?.ranges && state.decorations) {
        return { ranges: state.ranges, decorations: state.decorations };
      }
    }
    return undefined;
  };

  const decorationCount = (editor: Editor) =>
    pluginState(editor)?.decorations.find().length ?? -1;

  it("refresh meta re-renders anchors when thread data changes", () => {
    let threads: Record<string, { count: number; resolved: boolean }> = {
      T1: { count: 1, resolved: false },
    };
    const hooks: CommentHooks = {
      findThread: (id) => {
        const t = threads[id];
        return t ? { id, commentCount: t.count, resolved: t.resolved } : null;
      },
      openThread: () => {},
    };
    const editor = buildEditor(plainDoc([paragraphWithAnchor("T1")]), hooks);
    // Anchor highlight + counter bubble.
    expect(decorationCount(editor)).toBe(2);

    threads = { T1: { count: 3, resolved: true } };
    editor.view.dispatch(refreshComments(editor.state));
    expect(decorationCount(editor)).toBe(2);
    editor.destroy();
  });

  it("absent thread data renders the anchor without a counter bubble", () => {
    const hooks: CommentHooks = {
      findThread: () => null,
      openThread: () => {},
    };
    const editor = buildEditor(plainDoc([paragraphWithAnchor("T9")]), hooks);
    expect(decorationCount(editor)).toBe(1);
    editor.destroy();
  });

  it("no hooks — the mark registers but nothing decorates", () => {
    const editor = buildEditor(plainDoc([paragraphWithAnchor("T1")]));
    // Schema knows the mark (cross-generation documents load)…
    expect(editor.state.schema.marks.comment).toBeTruthy();
    // …but the plugin builds no decorations without hooks.
    expect(decorationCount(editor)).toBe(0);
    editor.destroy();
  });
});

describe("stored-JSON helpers", () => {
  it("jsonHasCommentMark finds the thread id anywhere in the doc", () => {
    const doc = plainDoc([paragraphWithAnchor("T1")]);
    expect(jsonHasCommentMark(doc, "T1")).toBe(true);
    expect(jsonHasCommentMark(doc, "T2")).toBe(false);
  });

  it("stripCommentMarkFromJson removes only the given thread's marks", () => {
    const doc: JSONContent = {
      type: "noteDoc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "a",
              marks: [
                { type: "bold" },
                { type: "comment", attrs: { id: "T1" } },
              ],
            },
            {
              type: "text",
              text: "b",
              marks: [{ type: "comment", attrs: { id: "T2" } }],
            },
          ],
        },
      ],
    };
    expect(stripCommentMarkFromJson(doc, "T1")).toBe(true);
    const first = doc.content?.[0]?.content?.[0];
    expect(first?.marks).toEqual([{ type: "bold" }]);
    const second = doc.content?.[0]?.content?.[1];
    expect(second?.marks).toEqual([{ type: "comment", attrs: { id: "T2" } }]);
    expect(stripCommentMarkFromJson(doc, "T1")).toBe(false);
  });
});
