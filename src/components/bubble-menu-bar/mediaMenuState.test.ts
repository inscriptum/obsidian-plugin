import { describe, it, expect } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { buildSchema } from "../../../tests/helpers/buildSchema";
import {
  getMediaMenuState,
  getSelectedMediaNode,
  isMediaNodeSelection,
} from "./mediaMenuState";

const schema = buildSchema();

function mediaState(nodeType: "image" | "attachment") {
  const node = schema.nodes[nodeType].create({
    key: "k-media",
    data: { id: "file.bin", filename: "report.pdf" },
  });
  const doc = schema.nodes.noteDoc.create(null, [
    schema.nodes.noteTitle.create(),
    node,
  ]);
  let pos = -1;
  doc.descendants((n, p) => {
    if (n.type.name === nodeType) {
      pos = p;
      return false;
    }
    return true;
  });
  const state = EditorState.create({
    doc,
    selection: NodeSelection.create(doc, pos),
  });
  return { state, doc };
}

describe("isMediaNodeSelection", () => {
  it("is true for an image or attachment node selection", () => {
    expect(isMediaNodeSelection(mediaState("image").state)).toBe(true);
    expect(isMediaNodeSelection(mediaState("attachment").state)).toBe(true);
  });

  it("is false for a text selection", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(),
      schema.nodes.paragraph.create(null, schema.text("hello")),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    expect(isMediaNodeSelection(state)).toBe(false);
  });
});

describe("getMediaMenuState", () => {
  it("returns nodeType, filename, hasFile and align for an image", () => {
    expect(getMediaMenuState(mediaState("image").state)).toEqual({
      nodeType: "image",
      filename: "report.pdf",
      hasFile: true,
      align: "left",
    });
  });

  it("returns the stored align for an image", () => {
    const node = schema.nodes.image.create({
      key: "k-media",
      data: { id: "file.bin", filename: "report.pdf" },
      align: "wrap-right",
    });
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(),
      node,
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
    expect(getMediaMenuState(state).align).toBe("wrap-right");
  });

  it("returns hasFile:false and align:left for a node without data.id", () => {
    const node = schema.nodes.image.create({ key: "k-empty", data: null });
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(),
      node,
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
    expect(getMediaMenuState(state)).toEqual({
      nodeType: "image",
      filename: "",
      hasFile: false,
      align: "left",
    });
  });

  it("returns a null state with align:null for a non-media selection", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(),
      schema.nodes.paragraph.create(null, schema.text("hello")),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    expect(getMediaMenuState(state)).toEqual({
      nodeType: null,
      filename: "",
      hasFile: false,
      align: null,
    });
  });

  it("returns align:null for an attachment selection", () => {
    expect(getMediaMenuState(mediaState("attachment").state).align).toBeNull();
  });
});

describe("getSelectedMediaNode", () => {
  it("returns the node and its position", () => {
    const { state, doc } = mediaState("image");
    const sel = getSelectedMediaNode(state);
    expect(sel).not.toBeNull();
    expect(sel!.node.type.name).toBe("image");
    expect(doc.nodeAt(sel!.pos)?.type.name).toBe("image");
  });

  it("returns null for a non-media selection", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.noteTitle.create(),
      schema.nodes.paragraph.create(null, schema.text("hello")),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1),
    });
    expect(getSelectedMediaNode(state)).toBeNull();
  });
});
