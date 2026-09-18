import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import { Selection, TextSelection } from "prosemirror-state";
import { Node as ProseMirrorNode } from "prosemirror-model";
import { Editor } from "../../core";
import { getExtensions } from "../../getExtensions";
import type { JSONContent } from "../../core/@types";
import {
  ensureTrailingParagraphJSON,
  trailingParagraphPlugin,
  trailingParagraphPluginKey,
} from "./trailingParagraph";

const CODE_BLOCK: JSONContent = {
  type: "hljsCodeBlock",
  content: [{ type: "hljsCodeBlockRow", content: [] }],
};
const TABLE: JSONContent = {
  type: "table",
  content: [
    {
      type: "tableRow",
      content: [
        { type: "tableCell", content: [{ type: "paragraph", content: [] }] },
      ],
    },
  ],
};

function createEditor(content?: JSONContent) {
  const defaultContent: JSONContent = {
    type: "noteDoc",
    content: [{ type: "noteTitle", content: [] }, { type: "paragraph" }],
  };
  return new Editor({
    element: createDiv(),
    content: content ?? defaultContent,
    extensions: getExtensions(),
  });
}

/** The initial editor state is built without a transaction, and the plugin
 *  deliberately ignores selection-only transactions, so tests must dispatch
 *  a real document change (a harmless character in the title) to trigger
 *  appendTransaction — the same path a real user's edit takes. */
function pump(editor: Editor): void {
  const pos = editor.state.doc.firstChild.nodeSize - 1;
  editor.view.dispatch(editor.state.tr.insertText("x", pos, pos));
}

function pumpSelectionOnly(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta("pump", true));
}

function blockTypes(doc: {
  forEach: (f: (node: { type: { name: string } }) => void) => void;
}): string[] {
  const types: string[] = [];
  doc.forEach((child) => types.push(child.type.name));
  return types;
}

/** Apply a transaction through the plugin on a bare state built from the
 *  real schema. The plugin itself has no editor closure, but the OTHER
 *  editor plugins do (e.g. nodeState init rewires state.doc to its own
 *  editor), so the full stack cannot be reused on a synthetic state — and
 *  image node views cannot initialize under jsdom at all. */
function applyWithPlugin(editor: Editor, docJSON: JSONContent): EditorState {
  const schema = editor.state.schema;
  const doc = ProseMirrorNode.fromJSON(schema, docJSON);
  const state = EditorState.create({
    doc,
    plugins: [trailingParagraphPlugin()],
  });
  // A real document change: the plugin ignores selection-only transactions.
  const tr: Transaction = state.tr.insertText("x", 1, 1);
  return state.apply(tr);
}

describe("ensureTrailingParagraphJSON", () => {
  it.each([
    ["code block", CODE_BLOCK],
    ["table", TABLE],
    ["image", { type: "image", attrs: { key: "k", data: { id: "d" } } }],
    [
      "heading",
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "h" }],
      },
    ],
    [
      "bullet list",
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "i" }] },
            ],
          },
        ],
      },
    ],
    [
      "blockquote",
      {
        type: "blockquote",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "q" }] },
        ],
      },
    ],
    ["horizontal rule", { type: "horizontalRule" }],
  ])("appends a paragraph after a trailing %s", (_name, trailing) => {
    const doc: JSONContent = {
      type: "noteDoc",
      content: [{ type: "noteTitle", content: [] }, trailing],
    };
    const result = ensureTrailingParagraphJSON(doc);
    expect(result.content).toHaveLength(3);
    expect(result.content![2].type).toBe("paragraph");
  });

  it("leaves documents ending with a paragraph untouched", () => {
    const doc: JSONContent = {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [] },
        { type: "paragraph", content: [{ type: "text", text: "x" }] },
      ],
    };
    const result = ensureTrailingParagraphJSON(doc);
    expect(result).toBe(doc);
    expect(result.content).toHaveLength(2);
  });

  it("passes through non-noteDoc input", () => {
    const doc: JSONContent = { type: "paragraph", content: [] };
    expect(ensureTrailingParagraphJSON(doc)).toBe(doc);
  });
});

describe("trailingParagraphPlugin", () => {
  it("appends a paragraph after a trailing heading in the live editor", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [] },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "h" }],
        },
      ],
    });

    pump(editor);

    const types = blockTypes(editor.state.doc);
    expect(types).toHaveLength(3);
    expect(types[types.length - 1]).toBe("paragraph");

    editor.destroy();
  });

  it("restores a caret-hostile doc end (code block) with a trailing paragraph", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [{ type: "noteTitle", content: [] }, CODE_BLOCK],
    });

    pump(editor);

    const types = blockTypes(editor.state.doc);
    expect(types[types.length - 1]).toBe("paragraph");
    expect(types).toHaveLength(3);

    editor.destroy();
  });

  it("appends a paragraph after a trailing image (bare state)", () => {
    const editor = createEditor();

    const state = applyWithPlugin(editor, {
      type: "noteDoc",
      content: [
        { type: "noteTitle" },
        { type: "image", attrs: { key: "k", data: { id: "d" } } },
      ],
    });

    const types = blockTypes(state.doc);
    expect(types).toHaveLength(3);
    expect(types[types.length - 1]).toBe("paragraph");

    editor.destroy();
  });

  it("appends exactly one paragraph, no loop", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [{ type: "noteTitle", content: [] }, CODE_BLOCK],
    });

    pump(editor);
    pump(editor);
    pump(editor);

    expect(blockTypes(editor.state.doc)).toHaveLength(3);

    editor.destroy();
  });

  it("does not touch documents already ending with a paragraph", () => {
    const editor = createEditor();
    pump(editor);
    expect(blockTypes(editor.state.doc)).toHaveLength(2);

    editor.destroy();
  });

  it("leaves the document unchanged on selection-only transactions", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [{ type: "noteTitle", content: [] }, CODE_BLOCK],
    });

    pumpSelectionOnly(editor);
    pumpSelectionOnly(editor);

    // Drag start / caret moves must stay doc-neutral: code building
    // transactions against the current state snapshot would break otherwise.
    expect(blockTypes(editor.state.doc)).toHaveLength(2);

    editor.destroy();
  });

  it("makes the document end reachable for a text caret", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [{ type: "noteTitle", content: [] }, CODE_BLOCK],
    });
    pump(editor);

    const selection = Selection.near(
      editor.state.doc.resolve(editor.state.doc.content.size),
      -1,
    );
    expect(selection instanceof TextSelection).toBe(true);
    expect(editor.state.doc.nodeAt(selection.from - 1)?.type.name).toBe(
      "paragraph",
    );

    editor.destroy();
  });

  it("re-appends the paragraph after it is deleted", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [{ type: "noteTitle", content: [] }, CODE_BLOCK],
    });
    pump(editor);

    const pos = editor.state.doc.content.size;
    const start = pos - 2; // an empty paragraph occupies two positions
    editor.view.dispatch(editor.state.tr.delete(start, pos));

    const types = blockTypes(editor.state.doc);
    expect(types[types.length - 1]).toBe("paragraph");

    editor.destroy();
  });

  it("keeps the trailing paragraph out of undo history", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [{ type: "noteTitle", content: [] }, CODE_BLOCK],
    });
    pump(editor);

    const end = editor.state.doc.content.size;
    editor.commands.insertContentAt(Math.max(end - 1, 0), "hi");
    expect(editor.getJSON().content?.[2]?.content?.[0]?.text).toBe("hi");

    editor.commands.undo();

    const types = blockTypes(editor.state.doc);
    expect(types[types.length - 1]).toBe("paragraph");
    expect(editor.getJSON().content?.[2]?.content).toBeUndefined();

    editor.destroy();
  });

  it("registers under its plugin key", () => {
    const editor = createEditor();
    expect(
      editor.state.plugins.some(
        (p) => p.key === trailingParagraphPluginKey.key,
      ),
    ).toBe(true);
    editor.destroy();
  });
});
