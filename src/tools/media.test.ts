import { describe, it, expect, vi } from "vitest";
import {
  EditorState,
  NodeSelection,
  type Transaction,
} from "prosemirror-state";
import { buildSchema } from "../../tests/helpers/buildSchema";
import { removeMediaNode, setImageNodeLayout } from "./media";

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
  const dispatch = vi.fn<(tr: Transaction) => void>();
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
    const tr = dispatch.mock.calls[0]?.[0];
    // ProseMirror keeps node attrs untyped — narrow to what the test reads.
    const attrs = tr?.doc.nodeAt(pos)?.attrs as
      | { key: string; data: { id: string }; align: string }
      | undefined;
    expect(attrs?.key).toBe("k-img");
    expect(attrs?.data.id).toBe("img.png");
    expect(attrs?.align).toBe("center");
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

describe("removeMediaNode — attachment unlink policy", () => {
  function makeEditorWithAttachment(data: Record<string, string>) {
    const node = schema.nodes.attachment.create({ data });
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(),
      node,
      schema.nodes.paragraph.create(null, schema.text("after")),
    ]);
    let pos = -1;
    doc.descendants((n, p) => {
      if (n.type.name === "attachment") {
        pos = p;
        return false;
      }
      return true;
    });
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, pos),
    });
    const dispatch = vi.fn<(tr: Transaction) => void>();
    const editor = {
      state,
      view: { dispatch },
    } as never as Parameters<typeof removeMediaNode>[0];
    return { editor, dispatch, doc, pos };
  }

  it("in-vault link: removes only the node — no file access on any path", () => {
    const { editor, dispatch, pos } = makeEditorWithAttachment({
      id: "docs/report.pdf",
      filename: "report.pdf",
    });

    removeMediaNode(editor);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const tr = dispatch.mock.calls[0][0];
    // The chip is unlinked (node gone)…
    expect(tr.doc.nodeAt(pos)?.type.name).toBe("paragraph");
    // …and the surrounding content is untouched.
    expect(tr.doc.textContent).toBe("after");
    // The unlink signature takes no App at all: the function cannot reach
    // vault file operations. A reintroduced deleteAttachmentFile call here
    // would not even compile.
  });

  it("external link: same unlink — the file outside the vault is never touched", () => {
    const { editor, dispatch, pos } = makeEditorWithAttachment({
      id: "/outside/report.pdf",
      filename: "report.pdf",
      mode: "external",
    });

    removeMediaNode(editor);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const tr = dispatch.mock.calls[0][0];
    expect(tr.doc.nodeAt(pos)?.type.name).toBe("paragraph");
  });
});
