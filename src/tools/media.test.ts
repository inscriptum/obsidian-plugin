import { describe, it, expect, vi } from "vitest";
import { EditorState, NodeSelection } from "prosemirror-state";
import { buildSchema } from "../../tests/helpers/buildSchema";
import { setImageNodeLayout } from "./media";

const schema = buildSchema();

function makeEditorWithImage(align?: string) {
  const node = schema.nodes.image.create({
    key: "k-img",
    data: { id: "img.png", filename: "img.png" },
    ...(align != null ? { align } : {}),
  });
  const doc = schema.nodes.noteDoc.create(null, [
    schema.nodes.noteTitle.create(),
    node,
    schema.nodes.paragraph.create(null, schema.text("after")),
  ]);
  let pos = -1;
  doc.descendants((n, p) => {
    if (n.type.name === "image") {
      pos = p;
      return false;
    }
    return true;
  });
  const state = EditorState.create({
    doc,
    selection: NodeSelection.create(doc, pos),
  });
  const dispatch = vi.fn();
  const editor = {
    state,
    view: { dispatch },
    commands: {},
  } as never as Parameters<typeof setImageNodeLayout>[0];
  return { editor, dispatch, doc, node, pos };
}

describe("setImageNodeLayout", () => {
  it("dispatches a setNodeMarkup with the new align", () => {
    const { editor, dispatch, pos } = makeEditorWithImage("left");
    setImageNodeLayout(editor, "wrap-right");
    expect(dispatch).toHaveBeenCalledTimes(1);
    const tr = dispatch.mock.calls[0][0];
    expect(tr.doc.nodeAt(pos)?.attrs.align).toBe("wrap-right");
  });

  it("keeps the other attrs intact", () => {
    const { editor, dispatch, pos } = makeEditorWithImage();
    setImageNodeLayout(editor, "center");
    const tr = dispatch.mock.calls[0][0];
    const attrs = tr.doc.nodeAt(pos)?.attrs;
    expect(attrs.key).toBe("k-img");
    expect(attrs.data.id).toBe("img.png");
    expect(attrs.align).toBe("center");
  });

  it("is a no-op when the selection is not a NodeSelection", () => {
    const { editor, dispatch } = makeEditorWithImage();
    const fakeEditor = {
      ...editor,
      state: { ...editor.state, selection: { from: 0, to: 1 } },
    } as typeof editor;
    setImageNodeLayout(fakeEditor, "center");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
