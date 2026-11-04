import { describe, expect, it } from "vitest";

import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";

function contentWithCodeBlock(lines: string[]) {
  // Row ids as a loaded document has them (NoteView runs assignBlockIds
  // on the stored JSON before the editor parses it; a bare Editor in a
  // test skips that path, so the ids go in explicitly).
  const ids = ["abcdefghij", "klmnopqrst"];
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [] },
      {
        type: "hljsCodeBlock",
        attrs: { class: "language-plaintext", id: "wxy123456z" },
        content: lines.map((text, i) => ({
          type: "hljsCodeBlockRow",
          attrs: { id: ids[i] ?? null },
          content: text.length ? [{ type: "text", text }] : [],
        })),
      },
    ],
  };
}

/** The ids of the code-block rows, in document order (the rows of one
 *  block — the note here holds a single block). */
function rowIds(editor: Editor): (string | null)[] {
  const ids: (string | null)[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "hljsCodeBlockRow") {
      ids.push((node.attrs.id as string | null) ?? null);
    }
    return true;
  });
  return ids;
}

function endOfRowText(editor: Editor, text: string): number {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (
      found == null &&
      node.type.name === "hljsCodeBlockRow" &&
      node.textContent === text
    ) {
      found = pos + node.nodeSize - 1;
      return false;
    }
    return true;
  });
  if (found == null) throw new Error(`row with text "${text}" not found`);
  return found;
}

// Regression test for issue code-block-row-ids: the code-block node view
// regenerates the rows on every content change and swaps them in place
// outside any transaction — the row ids must survive that swap, or every
// save "repairs" them with new values (console warnings + churning row
// addresses).
describe("code block row ids across node-view regeneration", () => {
  it("typing in a row keeps the rows' ids stable", () => {
    const el = createDiv();
    document.body.appendChild(el);

    const editor = new Editor({
      element: el,
      content: contentWithCodeBlock(["const", "x"]),
      extensions: getExtensions(),
      editable: true,
    });

    const before = rowIds(editor);
    expect(before).toEqual(["abcdefghij", "klmnopqrst"]);

    // A keystroke at the end of the first row's text.
    const endOfFirstRow = endOfRowText(editor, "const");
    expect(endOfFirstRow).not.toBeNull();
    editor.commands.insertContentAt(endOfFirstRow, "X");

    expect(rowIds(editor)).toEqual(before);

    editor.destroy();
    el.remove();
  });
});
