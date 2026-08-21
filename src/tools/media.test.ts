import { describe, it, expect, vi } from "vitest";
import { EditorState, NodeSelection, type Transaction } from "prosemirror-state";
import { buildSchema } from "../../tests/helpers/buildSchema";
import { nodeStatePluginKey } from "../texto/extensions/state";
import { openMediaFile, removeMediaNode, replaceMediaFile } from "./media";

const schema = buildSchema();

function mediaState(nodeType: "image" | "attachment") {
  const node = schema.nodes[nodeType].create({
    key: "k-media",
    data: { id: "file.bin", filename: "report.pdf" },
  });
  // Keep a paragraph after noteTitle so deleting the media node leaves a valid doc.
  const doc = schema.nodes.noteDoc.create(null, [
    schema.nodes.noteTitle.create(),
    schema.nodes.paragraph.create(null, schema.text("x")),
    node,
  ]);
  let pos = -1;
  doc.descendants((n, p) => { if (n.type.name === nodeType) { pos = p; return false; } return true; });
  const state = EditorState.create({ doc, selection: NodeSelection.create(doc, pos) });
  return { state, pos };
}

function fakeEditor(state: EditorState) {
  let captured: Transaction | null = null;
  const editor = {
    state,
    view: { dispatch: (tr: Transaction) => { captured = tr; } },
  };
  return { editor, getTr: () => captured };
}

describe("replaceMediaFile", () => {
  it("sets isAutoOpenFileSelection on the selected node, keeping key", () => {
    const { state, pos } = mediaState("image");
    const { editor, getTr } = fakeEditor(state);
    replaceMediaFile(editor as never);
    const next = state.apply(getTr()!);
    const attrs = next.doc.nodeAt(pos)!.attrs as { key: string; state: { isAutoOpenFileSelection: boolean } };
    expect(attrs.key).toBe("k-media");
    expect(attrs.state.isAutoOpenFileSelection).toBe(true);
  });
});

describe("removeMediaNode", () => {
  it("removes an image node and sets the state cleanup meta", () => {
    const { state, pos } = mediaState("image");
    const { editor, getTr } = fakeEditor(state);
    removeMediaNode(editor as never, {} as never);
    const tr = getTr()!;
    expect(state.apply(tr).doc.nodeAt(pos)).toBeNull();
    expect(tr.getMeta(nodeStatePluginKey)).toEqual({
      remove: { id: "k-media", transactionsMeta: { isChangeOrigin: false, isSilent: true } },
    });
  });

  it("removes an attachment node and deletes its file", () => {
    const { state, pos } = mediaState("attachment");
    const trashFile = vi.fn();
    const app = {
      vault: { getAbstractFileByPath: () => ({ path: "file.bin" }) },
      fileManager: { trashFile },
    };
    const { editor, getTr } = fakeEditor(state);
    removeMediaNode(editor as never, app as never);
    expect(state.apply(getTr()!).doc.nodeAt(pos)).toBeNull();
    expect(trashFile).toHaveBeenCalled();
  });
});

describe("openMediaFile", () => {
  it("calls openWithDefaultApp with the file id", () => {
    const openWithDefaultApp = vi.fn();
    const app = { openWithDefaultApp };
    const node = schema.nodes.image.create({ key: "k", data: { id: "file.bin" } });
    openMediaFile(app as never, node);
    expect(openWithDefaultApp).toHaveBeenCalledWith("file.bin");
  });

  it("is a no-op when the node has no id", () => {
    const openWithDefaultApp = vi.fn();
    const app = { openWithDefaultApp };
    const node = schema.nodes.image.create({ key: "k", data: null });
    openMediaFile(app as never, node);
    expect(openWithDefaultApp).not.toHaveBeenCalled();
  });
});
