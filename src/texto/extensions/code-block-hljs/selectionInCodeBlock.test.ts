import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { buildSchema } from "../../../../tests/helpers/buildSchema";
import { selectionInCodeBlock } from "./hljsCodeBlock";

const schema = buildSchema();

function docWithCodeBlock(codeText: string, afterText?: string) {
  const codeBlock = schema.nodes.hljsCodeBlock.create(null, [
    schema.nodes.hljsCodeBlockRow.create(null, schema.text(codeText)),
  ]);
  const children = [
    schema.nodes.noteTitle.create(),
    schema.nodes.paragraph.create(null, schema.text("plain text ")),
    codeBlock,
  ];
  if (afterText !== undefined) {
    children.push(
      schema.nodes.paragraph.create(null, schema.text(afterText)),
    );
  }
  return schema.nodes.noteDoc.create(null, children);
}

/** Text selection over `doc` between two content offsets relative to the
 *  code block: blockStart/blockEnd are the boundary positions of the
 *  hljsCodeBlock node itself. */
function select(doc: ReturnType<typeof docWithCodeBlock>, from: number, to: number) {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, from, to),
  });
}

function blockRange(doc: ReturnType<typeof docWithCodeBlock>) {
  let from = -1;
  let to = -1;
  doc.descendants((node, pos) => {
    if (node.type.name === "hljsCodeBlock") {
      from = pos;
      to = pos + node.nodeSize;
      return false;
    }
    return true;
  });
  return { from, to };
}

describe("selectionInCodeBlock", () => {
  it("is true for a selection entirely inside the code block", () => {
    const doc = docWithCodeBlock("const x = 1;");
    const { from, to } = blockRange(doc);
    // Block: open token, row (open token, text, close token), close token —
    // the text lives at [from + 2, to - 2].
    const state = select(doc, from + 2, to - 2);
    expect(selectionInCodeBlock(state)).toBe(true);
  });

  it("is true for a caret inside the code block", () => {
    const doc = docWithCodeBlock("const x = 1;");
    const { from } = blockRange(doc);
    const state = select(doc, from + 3, from + 3);
    expect(selectionInCodeBlock(state)).toBe(true);
  });

  it("is false for a plain paragraph selection", () => {
    const doc = docWithCodeBlock("const x = 1;");
    // noteTitle is 0-length; paragraph content spans [2, 2 + "plain text ".length]
    const state = select(doc, 2, 2 + "plain text ".length);
    expect(selectionInCodeBlock(state)).toBe(false);
  });

  it("is false when the selection crosses the block boundary", () => {
    const doc = docWithCodeBlock("const x = 1;", "after text");
    const { from, to } = blockRange(doc);
    // From the middle of the leading paragraph into the block.
    const state = select(doc, 4, from + 3);
    expect(selectionInCodeBlock(state)).toBe(false);
    // From the block out into the trailing paragraph.
    const state2 = select(doc, to - 3, to + 4);
    expect(selectionInCodeBlock(state2)).toBe(false);
  });

  it("is false for a selection spanning the whole block across its boundaries", () => {
    const doc = docWithCodeBlock("const x = 1;", "after text");
    const { from, to } = blockRange(doc);
    const state = select(doc, from, to);
    expect(selectionInCodeBlock(state)).toBe(false);
  });

  it("is false for a selection spanning two adjacent code blocks", () => {
    const first = schema.nodes.hljsCodeBlock.create(null, [
      schema.nodes.hljsCodeBlockRow.create(null, schema.text("aaa")),
    ]);
    const second = schema.nodes.hljsCodeBlock.create(null, [
      schema.nodes.hljsCodeBlockRow.create(null, schema.text("bbb")),
    ]);
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(),
      first,
      second,
    ]);
    let firstTo = -1;
    let secondFrom = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === "hljsCodeBlock") {
        if (firstTo === -1) firstTo = pos + node.nodeSize;
        else secondFrom = pos;
        return false;
      }
      return true;
    });
    const state = select(doc, firstTo, secondFrom);
    expect(selectionInCodeBlock(state)).toBe(false);
  });
});
